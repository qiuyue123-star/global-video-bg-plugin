// 冲突背景插件关键词库
const CONFLICT_PLUGIN_KEYWORDS = ["bg", "wallpaper", "背景", "壁纸", "dynamic-wall", "video-bg"];
let isConflict = false;
let conflictCheckTimer = null;

// 2秒轮询检测冲突插件
function startConflictLoop() {
    if (conflictCheckTimer) clearInterval(conflictCheckTimer);
    conflictCheckTimer = setInterval(async () => {
        const newConflict = await checkOtherBgPlugins();
        if (newConflict !== isConflict) {
            isConflict = newConflict;
            chrome.tabs.query({}, tabs => {
                tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: "conflictStateChange", conflict: isConflict }));
            })
        }
    }, 2000);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getBgConfig') {
        chrome.storage.local.get(['videoBinary', 'bgOpacity', 'videoName', 'videoType', 'updateTime'], res => {
            sendResponse({ ...res, conflict: isConflict });
        });
        return true;
    }
    if (msg.type === "checkConflict") {
        checkOtherBgPlugins().then(hasConflict => {
            isConflict = hasConflict;
            sendResponse({ conflict: hasConflict });
        })
        return true;
    }
    if (msg.type === "bgConfigUpdate") {
        chrome.tabs.query({}, tabs => {
            tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: "reloadBg" }));
        })
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    const data = await chrome.storage.local.get(['videoBinary']);
    if (data.videoBinary && data.videoBinary.length < 100) {
        await chrome.storage.local.remove('videoBinary');
    }
    await checkOtherBgPlugins();
    startConflictLoop();
});

// 检测其他背景插件
async function checkOtherBgPlugins() {
    const installedPlugins = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "getAllInstallPlugins" }, list => resolve(list || []))
    })
    for (const plugin of installedPlugins) {
        if (plugin.plugin_id === "global-video-bg-plugin") continue;
        const pid = plugin.plugin_id.toLowerCase();
        const name = plugin.name.toLowerCase();
        const isBgPlugin = CONFLICT_PLUGIN_KEYWORDS.some(key => pid.includes(key) || name.includes(key));
        if (isBgPlugin) return true;
    }
    return false;
}
