# RWD Capture

Windows 本機 Chrome／Edge RWD 全頁截圖工具。Vue 3 + TypeScript + Node.js + Playwright。

## 啟動

安裝 Node.js 22 LTS、Google Chrome、Microsoft Edge，雙擊 `start.cmd`。第一次需要網路安裝 npm 套件；建置後自動開啟 http://127.0.0.1:4317 。請保持命令視窗開啟，按 Ctrl+C 停止。

開發：`npm ci`，PowerShell 執行 `$env:NODE_ENV='development'; npm run dev`。驗證：`npm test`、`npm run build`。

## 使用

1. 輸入一個完整網址，勾選瀏覽器和尺寸，按開始擷取。
2. 預設不登入。需要登入時勾選登入狀態，依序開啟各瀏覽器、手動登入、按完成登入並保存。兩個瀏覽器都必須有保存狀態。
3. 圖庫依尺寸並排呈現，點擊圖片放大或開啟原圖。可取消工作或重試未完成項目。
4. `captures/` 保存截圖與 manifest，`data/` 保存登入憑證；不要分享 data。設定在首次啟動產生的 `screenshot.config.json`，可在進階設定編輯、匯入及匯出。

設定使用 profiles × resolutions，尺寸的裝置設定優先於 profile，false 值也會保留。EXE 路徑優先於 channel；兩者皆未設定時須另執行 `npx playwright install chromium`。指定 Chrome／Edge 失敗時不會替換瀏覽器。

viewport 為 CSS 像素，PNG 為裝置像素。預設 12 尺寸 × 2 瀏覽器 = 24 張。UA 為自訂模擬字串，並不表示實際瀏覽器版本；manifest 記錄兩者。

## 行為與限制

- 自動捲動最多 100 步／60 秒；圖片與背景圖片解碼等待最多 15 秒，失敗會在結果顯示警告。字型也會等待。頁面中虛擬清單、內嵌捲動容器、特殊互動載入內容不保證完整。
- 導覽 45 秒、就緒元素 30 秒、截圖 60 秒；失敗重試一次。預設每個瀏覽器同時一組；不允許多批同時執行。
- 保存 cookies、localStorage、IndexedDB 及已開啟頁面的 sessionStorage。特殊 SSO、裝置綁定、過期憑證可能需重新登入。工具不自動辨識所有網站的登入失效；若截到登入畫面，請重新保存登入狀態。
- cookie 視窗、廣告原樣保留。可在進階設定開啟可見瀏覽器，增加等待時間供手動操作。
- 固定輸出至工具內 captures，可整包移到其他可寫目錄使用。超長頁面可能受瀏覽器／記憶體限制而失敗，失敗不會冒充成功。
- 本機服務僅監聽 loopback 並拒絕外站 Origin。登入資料以本機 JSON 保存，無額外加密；使用作業系統帳號權限保護。

完成結果亦可在圖庫輸入完整本機路徑，按『匯出本批截圖與報告』。工具建立獨立工作子資料夾，不覆寫既有資料。

已驗證：npm test、正式建置、Chrome／Edge 全 24 組截圖與延遲圖片、裝置倍率、Vue 圖庫，以及兩瀏覽器登入狀態保存／使用／清除。測試使用本機測試網站；實際網站登入相容性仍依網站機制而異。
