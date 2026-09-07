# PikPak Desktop

独立的 PikPak 桌面客户端原型，使用 Electron + Vue 3。

## 运行

```powershell
cd pikpak-client
npm install
npm run dev
```

生成 Windows 便携版：

```powershell
npm run package:win
```

产物位于 `release/PikPak-Desktop-0.5.0-portable.exe`。

## 当前能力

- Windows 桌面三栏资源管理器界面
- 官方网页登录窗口与授权请求捕获
- 使用系统安全存储加密保存访问令牌
- 浏览已连接账户的目录和文件
- 通过隔离的官方页面桥接提取 opaque token，浏览公开分享的深层目录
- 图片缩略图、媒体直链与元数据显示
- 内置视频和音频播放器
- 本地下载任务、进度、取消与完成后定位
- 自动分页加载完整目录
- 新建文件夹、重命名和移入回收站
- 下载历史持久化、异常退出恢复标记和记录清理
- 当前目录搜索及名称、大小、时间排序
- 原创 Windows 应用图标与渲染失败错误页
- 复制、剪切并粘贴到其他目录
- 回收站浏览、恢复和永久删除
- 主进程统一处理 PikPak API 和 captcha 签名

## 当前限制

- 网页登录依赖 PikPak 当前登录页面；仍保留手动 Access Token 作为高级兜底。
- 分享 API 不公开子目录所需的 opaque token，因此分享的深层目录浏览需要后续加入内置网页会话桥接。
- PikPak 接口并非稳定的公开桌面 SDK，站点升级后可能需要适配。
