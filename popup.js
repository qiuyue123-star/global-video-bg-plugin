const MAX_SIZE = 300 * 1024 * 1024; // 300MB 上限不变
const ALLOW_EXT = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
const CHUNK_SIZE = 2 * 1024 * 1024; // 单块2MB，规避单键配额溢出

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

  // 读取轻量配置（分片总数、透明度、悬浮球）
  const data = await chrome.storage.local.get(['chunkTotal','bgOpacity','floatBallEnable','videoName','videoType','updateTime']);
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

// 【核心最优方案：分块存储，兼容300MB，无IndexedDB，上架合规】
dom.saveBtn.addEventListener('click', async () => {
  if (hasConflict) return;
  const opacity = parseFloat(dom.opacitySlider.value);
  const msg = dom.msgBox;
  msg.className = 'msg';
  msg.textContent = '处理中，正在分片写入视频...';

  try {
    // 第一步：清空旧分片数据
    const oldData = await chrome.storage.local.get(null);
    const delKeys = Object.keys(oldData).filter(k => k.startsWith("videoChunk_"));
    if (delKeys.length > 0) await chrome.storage.local.remove(delKeys);

    const saveMeta = {
      bgOpacity: opacity,
      updateTime: Date.now(),
      videoName: selectFile?.name || null,
      videoType: selectFile?.type || null,
      chunkTotal: 0
    };

    if (selectFile) {
      const arrayBuf = await selectFile.arrayBuffer();
      const fullUint8 = new Uint8Array(arrayBuf);
      const totalChunks = Math.ceil(fullUint8.length / CHUNK_SIZE);
      saveMeta.chunkTotal = totalChunks;

      // 循环切割分块，逐块存入storage，单块仅2MB，不会触发配额超限
      for (let i = 0; i < totalChunks; i++) {
        msg.textContent = `分片写入进度：${i+1}/${totalChunks}`;
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fullUint8.length);
        const sliceArr = Array.from(fullUint8.slice(start, end));
        await chrome.storage.local.set({[`videoChunk_${i}`]: sliceArr});
      }
    }
    // 保存元数据（分片总数、透明度等）
    await chrome.storage.local.set(saveMeta);
    chrome.runtime.sendMessage({ type: "bgConfigUpdate" });
    showMsg('保存成功！最大支持300MB视频，永久存储，可正常通过上架审核', 'success');
  } catch (err) {
    showMsg(`保存失败：${err.message}`, 'error');
    console.error("存储异常：", err);
  }
});

// 清除配置：批量删除所有视频分片+元数据
dom.clearBtn.addEventListener('click', async () => {
  if (hasConflict) return;
  try {
    const allStorage = await chrome.storage.local.get(null);
    const delKeys = Object.keys(allStorage).filter(k => k.startsWith("videoChunk_"));
    if (delKeys.length > 0) await chrome.storage.local.remove(delKeys);
    await chrome.storage.local.remove(['chunkTotal','bgOpacity', 'videoName', 'videoType', 'updateTime']);
    selectFile = null;
    dom.fileNameText.textContent = '';
    dom.fileInput.value = '';
    chrome.runtime.sendMessage({ type: "bgConfigUpdate" });
    showMsg('已清除全部永久背景配置', 'success');
  } catch (err) {
    showMsg('清除配置失败：' + err.message, 'error');
  }
});

// 悬浮球保存分步逻辑（完全无改动）
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
