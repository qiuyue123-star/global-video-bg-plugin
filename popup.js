const MAX_SIZE = 300 * 1024 * 1024; // 300MB 上限不变
const ALLOW_EXT = ['mp4', 'webm', 'mov', 'avi', 'mkv'];

const dom = {
  fileInput: document.getElementById('video-input'),
  selectBtn: document.getElementById('select-btn'),
  fileNameText: document.getElementById('file-name'),
  opacitySlider: document.getElementById('opacity-slider'),
  opacityVal: document.getElementById('opacity-value'),
  saveBtn: document.getElementById('save-btn'),
  clearBtn: document.getElementById('clear-btn'),
  msgBox: document.getElementById('msg'),
  // 悬浮球DOM
  floatBallSwitch: document.getElementById('floatBallSwitch'),
  saveFloatConfig: document.getElementById('saveFloatConfig'),
  floatTip: document.getElementById('floatTip')
};

let selectFile = null;
let hasConflict = false;
let popupConflictTimer = null;
// 唯一视频ID，用于IndexedDB索引
const VIDEO_STORE_ID = "global-bg-video-001";

// 实时刷新冲突状态
async function refreshConflictStatus() {
  const conflictRes = await chrome.runtime.sendMessage({type: "checkConflict"});
  hasConflict = conflictRes.conflict;
  if (hasConflict) {
    dom.selectBtn.disabled = true;
    dom.saveBtn.disabled = true;
    dom.opacitySlider.disabled = true;
    dom.saveFloatConfig.disabled = true;
    dom.floatBallSwitch.disabled = true;
    showMsg("⚠️ 检测到其他背景插件，本插件已禁用，无法叠加生效，请卸载其他背景插件", "error");
  } else {
    dom.selectBtn.disabled = false;
    dom.saveBtn.disabled = false;
    dom.opacitySlider.disabled = false;
    dom.saveFloatConfig.disabled = false;
    dom.floatBallSwitch.disabled = false;
    dom.msgBox.textContent = "";
  }
}

window.onload = async () => {
  await refreshConflictStatus();
  popupConflictTimer = setInterval(refreshConflictStatus, 1500);

  // 读取透明度、悬浮球、视频元数据（轻量数据，无容量压力）
  const data = await chrome.storage.local.get(['videoId','bgOpacity','floatBallEnable','videoName','videoType','fileSize']);
  if (data.bgOpacity) {
    dom.opacitySlider.value = data.bgOpacity;
    dom.opacityVal.textContent = data.bgOpacity;
  }
  dom.floatBallSwitch.checked = !!data.floatBallEnable;
};

window.addEventListener('unload', () => {
  clearInterval(popupConflictTimer);
});

// 滑块数值同步
dom.opacitySlider.addEventListener('input', () => {
  if (hasConflict) return;
  dom.opacityVal.textContent = dom.opacitySlider.value;
});

dom.selectBtn.addEventListener('click', () => {
  if (hasConflict) return;
  dom.fileInput.click()
});

// 文件选择校验逻辑不变
dom.fileInput.addEventListener('change', (e) => {
  if (hasConflict) return;
  const file = e.target.files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();

  if (!ALLOW_EXT.includes(ext)) {
    showMsg(`不支持.${ext}格式，仅支持mp4/webm/mov/avi/mkv`, 'error');
    selectFile = null;
    dom.fileNameText.textContent = '';
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg('文件超过300MB限制，请压缩视频', 'error');
    selectFile = null;
    dom.fileNameText.textContent = '';
    return;
  }
  selectFile = file;
  dom.fileNameText.textContent = `已选中：${file.name}（${(file.size / 1024 / 1024).toFixed(2)}MB）`;
  showMsg('文件校验通过，可保存', 'success');
});

// 【核心优化】分离存储：轻量配置存storage，大视频二进制存入IndexedDB，永久保存，无配额限制
dom.saveBtn.addEventListener('click', async () => {
  if (hasConflict) return;
  const opacity = parseFloat(dom.opacitySlider.value);
  const msg = dom.msgBox;
  msg.className = 'msg';
  msg.textContent = '处理中...';

  try {
    // 基础轻量配置（极小体积，存入storage无压力）
    const saveMeta = {
      videoId: VIDEO_STORE_ID,
      bgOpacity: opacity,
      updateTime: Date.now(),
      videoName: selectFile?.name || null,
      fileSize: selectFile?.size || null,
      videoType: selectFile?.type || null
    };
    await chrome.storage.local.set(saveMeta);

    // 存在新视频：读取二进制存入IndexedDB大容量数据库
    if (selectFile) {
      msg.textContent = "正在写入视频永久存储...";
      const arrayBuffer = await selectFile.arrayBuffer();
      const uint8Arr = Array.from(new Uint8Array(arrayBuffer));
      // 发送至后台写入IndexedDB
      const dbRes = await chrome.runtime.sendMessage({
        type: "saveVideoDB",
        videoId: VIDEO_STORE_ID,
        binaryArr: uint8Arr,
        meta: { name: selectFile.name, size: selectFile.size, type: selectFile.type }
      });
      if (!dbRes.success) throw new Error(dbRes.err || "数据库写入失败");
    }
    // 通知全页面刷新背景
    chrome.runtime.sendMessage({ type: "bgConfigUpdate" });
    showMsg('保存成功！视频永久存储，重启客户端不丢失，最大支持300MB', 'success');
  } catch (err) {
    showMsg(`保存失败：${err.message}`, 'error');
    console.error("存储异常：", err);
  }
});

// 清除配置逻辑：同步删除IndexedDB内视频+storage配置
dom.clearBtn.addEventListener('click', async () => {
  if (hasConflict) return;
  try {
    // 删除数据库视频
    await chrome.runtime.sendMessage({type:"deleteVideoDB",videoId:VIDEO_STORE_ID});
    // 删除本地轻量配置
    await chrome.storage.local.remove(['videoId','bgOpacity', 'videoName', 'fileSize', 'videoType', 'updateTime']);
    selectFile = null;
    dom.fileNameText.textContent = '';
    dom.fileInput.value = '';
    chrome.runtime.sendMessage({ type: "bgConfigUpdate" });
    showMsg('已清除全部永久背景配置', 'success');
  } catch (err) {
    showMsg('清除配置失败：' + err.message, 'error');
  }
});

// 悬浮球保存分步逻辑（无改动）
dom.saveFloatConfig.addEventListener('click', async () => {
  if (hasConflict) return;
  const enable = dom.floatBallSwitch.checked;
  dom.floatTip.textContent = "正在配置悬浮球……";
  await new Promise(res=>setTimeout(res,600));

  await chrome.storage.local.set({floatBallEnable: enable});
  dom.floatTip.textContent = "配置悬浮球成功！";
  await new Promise(res=>setTimeout(res,600));

  dom.floatTip.textContent = "正在创建悬浮球……";
  await new Promise(res=>setTimeout(res,800));

  chrome.runtime.sendMessage({type:"reloadFloatBall"});
  dom.floatTip.textContent = "创建成功！请重新刷新页面。";
});

function showMsg(text, type = '') {
  dom.msgBox.textContent = text;
  dom.msgBox.className = `msg ${type}`;
}
