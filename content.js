let bgWrapEl = null;

// 独立渲染视频背景，无需其他背景插件打底
async function renderVideoBg() {
    const config = await chrome.runtime.sendMessage({ type: 'getBgConfig' });
    // 存在冲突 / 无存储视频数据 → 移除背景
    if (config.conflict || !config.videoBinary || config.videoBinary.length === 0) {
        removeOldBg();
        return;
    }
    removeOldBg();

    // 将永久存储的二进制数组还原为视频Blob源
    const uint8Data = new Uint8Array(config.videoBinary);
    const videoBlob = new Blob([uint8Data], { type: config.videoType });
    const permanentBlobUrl = URL.createObjectURL(videoBlob);

    // 独立全屏背景容器，层级覆盖客户端底层，完全独立渲染
    const wrap = document.createElement('div');
    wrap.style = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: -99999;
        overflow: hidden;
        pointer-events: none;
        opacity: ${config.bgOpacity || 0.7};
        background: #000;
    `;

    const video = document.createElement('video');
    video.src = permanentBlobUrl;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.style = `
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scale(1.02);
    `;
    wrap.appendChild(video);
    document.body.prepend(wrap);
    bgWrapEl = wrap;
}

// 销毁现有背景容器
function removeOldBg() {
    if (bgWrapEl && bgWrapEl.parentNode) {
        bgWrapEl.remove();
        bgWrapEl = null;
    }
}

// 页面首次加载渲染独立背景
window.addEventListener('DOMContentLoaded', renderVideoBg);

// 监听后台消息：配置更新 / 冲突状态切换
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "reloadBg") renderVideoBg();
    if (msg.type === "conflictStateChange") {
        msg.conflict ? removeOldBg() : renderVideoBg();
    }
});
