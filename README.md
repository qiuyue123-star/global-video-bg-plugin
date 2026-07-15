# 全局自定义动态背景插件 global-video-bg-plugin
## 功能介绍
1. 完全独立渲染动态视频背景，无需依赖任何其他自定义背景插件，单独安装即可生效
2. 本地视频永久二进制持久化存储，重启客户端/电脑背景配置不丢失
3. 支持上传本地视频作为全局底层动态壁纸，视频限制最大300MB
4. 兼容 mp4 / webm / mov / avi / mkv 五种主流视频格式
5. 0.1~1.0透明度滑块实时调节，一键保存/清除配置
6. 插件互斥机制：检测到其他背景/壁纸插件时自动隐藏本插件背景，弹窗锁定所有操作，杜绝多层画面叠加
7. 保存配置后全页面实时刷新，无需重启客户端
8.配合自定义背景插件，上传静态图片后将背景透明度改为0%，然后保存，即可只有自定义动态背景显示。

## 安装方式    最新版本：v1.0.3
1. 客户端插件市场直接安装（上架后）
2. 手动安装：打包源码为zip → 设置-插件管理-本地安装插件

## 开发参考仓库
1. MoeKoeMusic主程序：https://github.com/MoeKoeMusic/MoeKoeMusic
2. MoeKoe插件开发示例：https://github.com/MoeKoeMusic/moekoe-helper
3. 酷狗音乐API：https://github.com/MakcRe/KuGouMusicApi

## 互斥说明
插件与`custom-app-background`、`custom-background`等所有背景类插件互斥，无法同时启用；使用前请卸载其他背景插件。
