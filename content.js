let bgWrapEl = null;
let videoEl = null;
let floatBall = null;
let isImmersiveMode = false;
let dragOffsetX = 0;
let dragOffsetY = null;
const originalStyleMap = new WeakMap();
let currentVideoBlobUrl = null;
const VIDEO_STORE_ID = "global-bg-video-001";
let cachedBgConfig = null;
// 缓冲节流标记，防止高码率视频无限回退
let bufferLock = false;
// 视频内存阈值，超大视频自动降低缓冲占用
const MAX_VIDEO_BUFFER_SEC = 12;

// 渲染全局视频背景（高码率长视频专用优化版：分段缓冲、节流防回退、内存限制）
async function renderVideoBg() {
    if (!cachedBgConfig) {
        cachedBgConfig = await chrome.runtime.sendMessage({ type: 'getBgConfig' });
    }
    const config = cachedBgConfig;

    if (config.conflict || !config.videoId) {
        removeOldBg();
        return;
    }

    // 已有视频实例仅更新透明度，不重载视频源
    if (bgWrapEl && videoEl) {
        videoEl.style.opacity = config.bgOpacity || 0.7;
        return;
    }

    removeOldBg();

    // 读取完整视频二进制
    const videoData = await chrome.runtime.sendMessage({
        type: "getFullVideoData",
        videoId: VIDEO_STORE_ID
    });
    if (!videoData || !videoData.binary) return;

    const uint8Data = new Uint8Array(videoData.binary);
    const videoBlob = new Blob([uint8Data], { type: config.videoType || "video/mp4" });
    currentVideoBlobUrl = URL.createObjectURL(videoBlob);

    // 硬件加速底层容器
    bgWrapEl = document.createElement('div');
    bgWrapEl.style = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: -999999;
        overflow: hidden;
        pointer-events: none;
        opacity: ${config.bgOpacity || 0.7};
        background: #000;
        transform: translateZ(0);
        will-change: transform, opacity;
    `;

    videoEl = document.createElement('video');
    videoEl.src = currentVideoBlobUrl;
    videoEl.autoplay = true;
    videoEl.loop = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    // 超大长视频使用预加载元数据，避免一次性加载全部帧阻塞
    videoEl.preload = "metadata";
    // 限制视频最大缓冲时长，防止内存溢出
    videoEl.bufferedMaxLength = MAX_VIDEO_BUFFER_SEC;
    videoEl.style = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scale(1.02) translateZ(0);
        will-change: transform;
        image-rendering: high-quality;
    `;

    // 【核心修复1】缓冲节流锁，杜绝高码率视频无限回退循环
    videoEl.addEventListener("waiting", async () => {
        if (bufferLock) return;
        bufferLock = true;
        // 仅缓冲耗尽时小幅后退，不频繁重置
        if (videoEl.currentTime > 1) {
            videoEl.currentTime = videoEl.currentTime - 1;
        }
        await new Promise(res => setTimeout(res, 1200));
        bufferLock = false;
    });

    // 【核心修复2】循环结束平稳重置，不突兀回退
    videoEl.addEventListener("ended", () => {
        videoEl.currentTime = 0;
        videoEl.play().catch(() => {});
    });

    // 【核心修复3】定时清理多余缓冲，释放内存（解决高分辨率长视频内存堆积）
    setInterval(() => {
        if (!videoEl || videoEl.buffered.length === 0) return;
        const bufferedEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
        const currentTime = videoEl.currentTime;
        // 清除播放位置之前的过期缓冲，大幅降低内存占用
        if (currentTime > 3) {
            videoEl.currentTime = currentTime;
        }
    }, 4000);

    // 播放失败自动重试加载
    videoEl.addEventListener("error", () => {
        videoEl.load();
        setTimeout(() => videoEl.play().catch(() => {}), 800);
    });

    bgWrapEl.appendChild(videoEl);
    document.body.prepend(bgWrapEl);
}

// 销毁背景容器，精准释放视频内存
function removeOldBg() {
    if (videoEl) {
        videoEl.pause();
        videoEl.removeAttribute("src");
        videoEl.load();
    }
    if (bgWrapEl && bgWrapEl.parentNode) {
        bgWrapEl.remove();
        bgWrapEl = null;
        videoEl = null;
        cachedBgConfig = null;
    }
    // 仅彻底清除视频配置时销毁Blob，沉浸式切换保留视频源
    if (currentVideoBlobUrl && !cachedBgConfig?.videoId) {
        URL.revokeObjectURL(currentVideoBlobUrl);
        currentVideoBlobUrl = null;
    }
}

// ===================== 悬浮球全套逻辑（完全无改动） =====================
async function createFloatBall() {
    const cfg = cachedBgConfig || await chrome.runtime.sendMessage({type:"getBgConfig"});
    if(cfg.conflict || !cfg.floatBallEnable){
        destroyFloatBall();
        return;
    }
    if(floatBall) return;

    floatBall = document.createElement("div");
    floatBall.id = "moekoe-float-preview-ball";
    floatBall.style = `
        position: fixed;
        right: 24px;
        bottom: 140px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: linear-gradient(135deg,#7c4dff,#4096ff);
        z-index: 9999999;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 18px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.4);
        cursor: grab;
        user-select: none;
        transform: translateZ(0);
        will-change: left, top;
    `;
    floatBall.innerText = "预览";
    document.body.appendChild(floatBall);

    let isDrag = false;
    floatBall.addEventListener("mousedown",(e)=>{
        isDrag = true;
        dragOffsetX = e.clientX - floatBall.getBoundingClientRect().left;
        dragOffsetY = e.clientY - floatBall.getBoundingClientRect().top;
        floatBall.style.cursor = "grabbing";
    })
    document.addEventListener("mousemove",(e)=>{
        if(!isDrag) return;
        const x = e.clientX - dragOffsetX;
        const y = e.clientY - dragOffsetY;
        floatBall.style.left = x + "px";
        floatBall.style.right = "auto";
        floatBall.style.top = y + "px";
        floatBall.style.bottom = "auto";
    })
    document.addEventListener("mouseup",()=>{
        isDrag = false;
        floatBall.style.cursor = "grab";
    })

    floatBall.addEventListener("click",(e)=>{
        const moveDist = Math.abs(dragOffsetX - (e.clientX - floatBall.offsetLeft)) + Math.abs(dragOffsetY - (e.clientY - floatBall.offsetTop));
        if(moveDist > 5) return;
        toggleImmersiveMode();
    })
}

function destroyFloatBall(){
    if(floatBall && floatBall.parentNode){
        floatBall.remove();
        floatBall = null;
    }
}

// 沉浸式模式：仅隐藏UI，不销毁视频实例，播放不中断
function toggleImmersiveMode(){
    isImmersiveMode = !isImmersiveMode;
    const hideAllUISelectors = [
        ".app-header",".top-header",".header-nav",".header-left",".header-right",
        ".page-main",".page-content",".recommend-block",".radio-card-box",".song-grid-wrap",".daily-title",
        ".search-input-wrap",".user-avatar-wrap","aside",".sidebar",".left-menu",
        ".song-list-modal",".modal-header",".song-table-wrap",".modal-mask",".player-bottom"
    ];

    if(isImmersiveMode){
        hideAllUISelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                if(!originalStyleMap.has(el)) originalStyleMap.set(el, el.style.display || "");
                el.style.display = "none";
            })
        })
        floatBall.innerText = "退出";
    }else{
        hideAllUISelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                const originDisplay = originalStyleMap.get(el);
                el.style.display = originDisplay;
            })
        })
        floatBall.innerText = "预览";
    }
}

window.addEventListener('DOMContentLoaded', async ()=>{
    await renderVideoBg();
    await createFloatBall();
});

// 后台消息监听，仅更新透明度，不重载视频源
chrome.runtime.onMessage.addListener(async (msg) => {
    if (msg.type === "reloadBg") {
        cachedBgConfig = null;
        await renderVideoBg();
    }
    if (msg.type === "conflictStateChange") {
        cachedBgConfig = null;
        msg.conflict ? removeOldBg() : await renderVideoBg();
        await createFloatBall();
    }
    if(msg.type === "reloadFloatBall"){
        destroyFloatBall();
        await createFloatBall();
    }
});
