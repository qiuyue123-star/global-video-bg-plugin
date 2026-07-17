let bgWrapEl = null;
let videoEl = null;
let floatBall = null;
let isImmersiveMode = false;
let dragOffsetX = 0;
let dragOffsetY = null;
const originalStyleMap = new WeakMap();
let currentVideoBlobUrl = null;
let cachedBgConfig = null;
let bufferLock = false;
const MAX_VIDEO_BUFFER_SEC = 12;
const CHUNK_SIZE = 2 * 1024 * 1024;

// 渲染全局视频背景（分片读取拼接完整视频，支持300MB永久存储）
async function renderVideoBg() {
    if (!cachedBgConfig) {
        cachedBgConfig = await chrome.runtime.sendMessage({ type: 'getBgConfig' });
    }
    const config = cachedBgConfig;

    // 无分片标记/冲突，销毁背景
    if (config.conflict || !config.chunkTotal || config.chunkTotal === 0) {
        removeOldBg();
        return;
    }

    // 已有视频实例仅更新透明度，不重载视频
    if (bgWrapEl && videoEl) {
        videoEl.style.opacity = config.bgOpacity || 0.7;
        return;
    }
    removeOldBg();

    // 读取全部分片，拼接完整Uint8数组
    const allData = await chrome.storage.local.get(null);
    const totalChunks = config.chunkTotal;
    const fullParts = [];
    for (let i = 0; i < totalChunks; i++) {
        const chunk = allData[`videoChunk_${i}`];
        if (!chunk) continue;
        fullParts.push(new Uint8Array(chunk));
    }
    // 拼接所有分片为完整二进制
    const totalByteLen = fullParts.reduce((sum, arr) => sum + arr.length, 0);
    const fullVideoBuf = new Uint8Array(totalByteLen);
    let offset = 0;
    fullParts.forEach(part => {
        fullVideoBuf.set(part, offset);
        offset += part.length;
    });

    // 生成永久Blob视频源
    const videoBlob = new Blob([fullVideoBuf], { type: config.videoType || "video/mp4" });
    if(currentVideoBlobUrl) URL.revokeObjectURL(currentVideoBlobUrl);
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
    videoEl.preload = "metadata";
    videoEl.bufferedMaxLength = MAX_VIDEO_BUFFER_SEC;
    videoEl.style = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scale(1.02) translateZ(0);
        will-change: transform;
        image-rendering: high-quality;
    `;

    // 缓冲节流防回退（原有流畅优化逻辑不变）
    videoEl.addEventListener("waiting", async () => {
        if (bufferLock) return;
        bufferLock = true;
        if (videoEl.currentTime > 1) videoEl.currentTime = videoEl.currentTime - 1;
        await new Promise(res => setTimeout(res, 1200));
        bufferLock = false;
    });

    // 循环结束平稳重置
    videoEl.addEventListener("ended", () => {
        videoEl.currentTime = 0;
        videoEl.play().catch(() => {});
    });

    // 定时清理过期缓冲，控制内存占用
    setInterval(() => {
        if (!videoEl || videoEl.buffered.length === 0) return;
        const currentTime = videoEl.currentTime;
        if (currentTime > 3) videoEl.currentTime = currentTime;
    }, 4000);

    // 播放错误自动重试
    videoEl.addEventListener("error", () => {
        videoEl.load();
        setTimeout(() => videoEl.play().catch(() => {}), 800);
    });

    bgWrapEl.appendChild(videoEl);
    document.body.prepend(bgWrapEl);
}

// 销毁背景容器，释放视频内存
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
    if (currentVideoBlobUrl && !cachedBgConfig?.chunkTotal) {
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

// 沉浸式模式：全部UI隐藏（含底部播放器，仅隐藏UI不中断播放）
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

// 后台消息监听
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
