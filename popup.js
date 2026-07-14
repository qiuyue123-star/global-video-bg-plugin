const MAX_SIZE = 300 * 1024 * 1024; // 300MB
const ALLOW_EXT = ['mp4', 'webm', 'mov', 'avi', 'mkv'];

const dom = {
  fileInput: document.getElementById('video-input'),
  selectBtn: document.getElementById('select-btn'),
  fileNameText: document.getElementById('file-name'),
  opacitySlider: document.getElementById('opacity-slider'),
  opacityVal: document.getElementById('opacity-value'),
  saveBtn: document.getElementById('save-btn'),
  clearBtn: document.getElementById('clear-btn'),
  msgBox: document.getElementById('msg')
};

let selectFile = null;
let hasConflict = false;
let popupConflictTimer = null;

// 实时刷新冲突状态
async function refreshConflictStatus() {
  const conflictRes = await chrome.runtime.sendMessage({type: "checkConflict"});
  hasConflict = conflictRes.conflict;
  if (hasConflict) {
    dom.selectBtn.disabled = true;
    dom.saveBtn.disabled = true;
    dom.opacitySlider.disabled = true;
    showMsg("⚠️ 检测到其他背景插件，本插件已禁用，无法叠加生效，请卸载其他背景插件", "error");
  } else {
    dom.selectBtn.disabled = false;
    dom.saveBtn.disabled = false;
    dom.opacitySlider.disabled = false;
    dom.msgBox.textContent = "";
  }
}

window.onload = async () => {
  await refreshConflictStatus();
  popupConflictTimer = setInterval(refreshConflictStatus, 1500);

  // 读取历史透明度配置
  const data = await chrome.storage.local.get(['bgOpacity']);
  if (data.bgOpacity) {
    dom.opacitySlider.value = data.bgOpacity;
    dom.opacityVal.textContent = data.bgOpacity;
  }
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

// 【核心修改】永久存储二进制视频数据，重启不丢失
dom.saveBtn.addEventListener('click', async () => {
  if (hasConflict) return;
  const opacity = parseFloat(dom.opacitySlider.value);
  const msg = dom.msgBox;
  msg.className = 'msg';
  msg.textContent = '处理中...';

  try {
    const saveData = { bgOpacity: opacity, updateTime: Date.now() };
    // 有新视频文件：读取二进制数组永久存入storage
    if (selectFile) {
      const arrayBuffer = await selectFile.arrayBuffer();
      const uint8Arr = Array.from(new Uint8Array(arrayBuffer));
      saveData.videoBinary = uint8Arr;
      saveData.videoName = selectFile.name;
      saveData.fileSize = selectFile.size;
      saveData.videoType = selectFile.type;
    }
    await chrome.storage.local.set(saveData);
    // 通知全页面刷新背景
    chrome.runtime.sendMessage({ type: "bgConfigUpdate" });
    showMsg('保存成功！视频永久存储，无其他背景插件也可独立生效', 'success');
  } catch (err) {
    showMsg(`保存失败：${err.message}，视频过大请压缩后重试`, 'error');
    console.error("存储异常：", err);
  }
});

// 清除配置逻辑不变
dom.clearBtn.addEventListener('click', async () => {
  if (hasConflict) return;
  try {
    await chrome.storage.local.remove(['videoBinary', 'bgOpacity', 'videoName', 'fileSize', 'videoType', 'updateTime']);
    selectFile = null;
    dom.fileNameText.textContent = '';
    dom.fileInput.value = '';
    chrome.runtime.sendMessage({ type: "bgConfigUpdate" });
    showMsg('已清除全部永久背景配置', 'success');
  } catch (err) {
    showMsg('清除配置失败', 'error');
  }
});

function showMsg(text, type = '') {
  dom.msgBox.textContent = text;
  dom.msgBox.className = `msg ${type}`;
}
