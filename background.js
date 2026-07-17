// 冲突背景插件关键词库
const CONFLICT_PLUGIN_KEYWORDS = ["bg", "wallpaper", "背景", "壁纸", "dynamic-wall", "video-bg"];
let isConflict = false;
let conflictCheckTimer = null;
// IndexedDB 全局变量
let bgDB = null;
const DB_NAME = "GlobalVideoBgDB";
const STORE_NAME = "videoFileStore";
const DB_VERSION = 1;

// 初始化IndexedDB大容量数据库
function initBgDB() {
    return new Promise((resolve, reject) => {
        const dbRequest = indexedDB.open(DB_NAME, DB_VERSION);
        dbRequest.onupgradeneeded = (e) => {
            bgDB = e.target.result;
            // 创建存储容器，主键唯一
            if (!bgDB.objectStoreNames.contains(STORE_NAME)) {
                bgDB.createObjectStore(STORE_NAME, { keyPath: "id" });
            }
        };
        dbRequest.onsuccess = (e) => {
            bgDB = e.target.result;
            resolve(bgDB);
        };
        dbRequest.onerror = (err) => reject(err);
    });
}

// 写入视频二进制到IndexedDB（支持300MB大文件）
async function saveVideoToDB(videoId, videoUint8Arr, meta) {
    if (!bgDB) await initBgDB();
    return new Promise((resolve, reject) => {
        const tx = bgDB.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const putReq = store.put({
            id: videoId,
            binary: videoUint8Arr,
            meta: meta
        });
        putReq.onsuccess = resolve;
        putReq.onerror = reject;
    });
}

// 从IndexedDB读取完整视频数据
async function getVideoFromDB(videoId) {
    if (!bgDB) await initBgDB();
    return new Promise((resolve, reject) => {
        const tx = bgDB.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(videoId);
        getReq.onsuccess = (e) => resolve(e.target.result);
        getReq.onerror = reject;
    });
}

// 删除数据库内视频文件
async function clearVideoFromDB(videoId) {
    if (!bgDB) await initBgDB();
    return new Promise((resolve, reject) => {
        const tx = bgDB.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const delReq = store.delete(videoId);
        delReq.onsuccess = resolve;
        delReq.onerror = reject;
    });
}

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
    // 获取基础配置（不含视频二进制，仅轻量数据）
    if (msg.type === 'getBgConfig') {
        chrome.storage.local.get(['videoId','bgOpacity','floatBallEnable','videoName','videoType','updateTime'], res => {
            sendResponse({ ...res, conflict: isConflict });
        });
        return true;
    }
    // 读取完整视频二进制（IndexedDB接口）
    if (msg.type === "getFullVideoData") {
        getVideoFromDB(msg.videoId).then(data => sendResponse(data)).catch(err => sendResponse(null));
        return true;
    }
    // 保存视频到IndexedDB
    if (msg.type === "saveVideoDB") {
        saveVideoToDB(msg.videoId, msg.binaryArr, msg.meta).then(() => sendResponse({success:true})).catch(err => sendResponse({success:false,err:err.message}));
        return true;
    }
    // 清空数据库视频
    if (msg.type === "deleteVideoDB") {
        clearVideoFromDB(msg.videoId).then(()=>sendResponse({success:true})).catch(err=>sendResponse({success:false,err:err.message}));
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
    if(msg.type === "reloadFloatBall"){
        chrome.tabs.query({}, tabs=>{
            tabs.forEach(tab=>chrome.tabs.sendMessage(tab.id,{type:"reloadFloatBall"}));
        })
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    // 初始化大容量数据库
    await initBgDB();
    const data = await chrome.storage.local.get(['videoId']);
    if (data.videoId && data.videoId.length < 10) {
        await chrome.storage.local.remove('videoId');
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
 
