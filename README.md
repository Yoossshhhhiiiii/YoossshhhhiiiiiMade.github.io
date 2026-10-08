# 庫存管家

靜態 GitHub Pages 前端，Supabase Auth 與 Postgres 儲存共用庫存。
保留白底黑字介面、NTNU 校徽開場、五筆分頁、今日異動與日期區間統計。

## 啟用順序

1. 先由使用者在 Supabase Authentication 建立網站登入帳號。密碼只由使用者輸入，不放在程式或聊天。
2. 經使用者確認後，在 SQL Editor 執行 `supabase/001-warehouse.sql`。此檔只建立空的庫存資料表，不匯入任何裝置庫存。
3. 經確認後，管理員另外執行私有的帳號授權 SQL，將已確認的 Auth user UUID 加入 `warehouse_members`，並僅對首次匯入管理員設定 `can_import = true`。Email 與帳號 UUID 不寫入公開前端設定。
4. 確認 `cloud-config.js` 只包含 Project URL 與 Publishable key；不得包含 secret、service_role 或資料庫密碼。
5. 經使用者確認後發布網站。先在原本管理庫存的手機、原本同一個瀏覽器與網址開啟，登入網站帳號。
6. 下載「此裝置舊資料備份」，確認 JSON 檔已存到手機。勾選原手機與備份兩個確認，再執行首次匯入。
7. 首次匯入成功後，電腦與其他裝置登入核准帳號即可共用資料；不要從電腦另行匯入。

## 資料與權限

- 原本的 `inventory-materials`、`inventory-transactions`、`inventory-locations` 與照片匯入標記不會在雲端模式改寫或清除。備份不含登入 token、密碼或其他網站的資料。
- 原裝置舊資料只用於第一次匯入及備份，之後不再代表最新庫存。最新資料由雲端提供，可另下載雲端 JSON 備份。
- 所有資料表啟用 RLS。未登入者沒有讀寫權；未核准的登入帳號也不能讀取庫存。前端沒有註冊功能，不會把第一個登入者自動升成管理員。
- 一般瀏覽器沒有直接 insert/update/delete 權限。所有異動由已核准帳號呼叫受保護 RPC；庫存與紀錄在同一個資料庫交易內更新，拒絕負庫存。
- 調整庫存只傳增減量，由伺服器鎖定後計算；編輯材料資料不改庫存，版本衝突會拒絕而不是覆蓋其他裝置的變更。
- 送出前將操作 UUID 保存在此登入帳號專用的待確認紀錄中；不確定結果時停止新異動，重試同一個 UUID 不會重複扣除。斷線、載入失敗與登入失效不會退回本機寫入。
- 每 15 秒、恢復網路、切回分頁與「重新同步」時更新資料。這是輪詢同步，不是即時 WebSocket。
- 首次匯入一次完成材料、位置與歷史紀錄；歷史紀錄不會再次加減現有庫存。匯入失敗會回滾；雲端已有資料時拒絕再次覆蓋。

## 額外的自訂帳號

登入欄位同時接受原本的 Email 與管理員建立的自訂帳號。自訂帳號為 3–32 個英文字母、數字、底線或減號，以字母或數字開頭，不分大小寫；密碼完全保留原樣。

Supabase 密碼驗證仍使用 Email 型態識別碼：前端將自訂帳號轉成 `<username>@<usernameDomain>`，`usernameDomain` 使用專案專屬、不可收信的 `*.warehouse.invalid` 保留網域。這是額外的獨立帳號，不是公開真實 Email 的查詢表，也不是替既有 Email 帳號新增別名。畫面登入後只顯示自訂名稱。

建立順序：

1. 在 Supabase Authentication 的 Add user → Create new user 建立對應的內部識別碼；只對這個由管理員建立的帳號使用 Auto confirm，不關閉全站 Email 確認設定。
2. 由使用者親自輸入新密碼並提交；不要把密碼、service_role 或 secret 放到前端、SQL、Git 或聊天。
3. 核對已建立的 Auth user UUID、內部識別碼與確認狀態。取得此帳號存取倉庫資料的明確同意後，透過私有 SQL 加入 `warehouse_members`，`can_import = false`。只建立 Auth user 並不會取得庫存權限。
4. 用自訂名稱與剛設定的密碼登入，確認已授權帳號共用同一份庫存。原本的 Email 帳號和 RLS 不變。

自訂帳號沒有收信信箱，不提供 Email 驗證、邀請或忘記密碼信；忘記密碼需由管理員核實身分後協助重設。不要對內部識別碼寄信或改成他人可能持有的真實網域。不提供公開註冊、自動授權或首次匯入權限。

依據：[Supabase 密碼登入](https://supabase.com/docs/guides/auth/passwords)、[管理員建立帳號](https://supabase.com/docs/reference/javascript/auth-admin-createuser)。

## 驗證與限制

安裝測試依賴後執行 `npm test`。測試使用 jsdom 與 PGlite（真正的 Postgres 引擎）驗證 RLS、直接寫入拒絕、未核准帳號、初次匯入、冪等重試、負庫存、資料編輯衝突與 UI 斷線保護。
測試不替代真實手機／電腦登入及網路中斷驗收；初次手機匯入只能由使用者在原手機操作。

Supabase 預設寄信服務有限制；目前採用管理員先建立帳號的 Email＋密碼登入，不自動寄送登入信。新增使用者、密碼重設或 Email 通知需要另外規劃寄信服務。
LINE 通知及真正的 QR 掃描尚未串接，不會因這次同步更新而自動啟用。
目前每次同步讀取全部材料與歷史紀錄；資料量大時應改用分頁、日期查詢與增量同步。

Supabase 官方前端套件 2.117.3 固定存放於 `vendor/`，授權文件見 `vendor/SUPABASE-LICENSE`，不依賴執行時 CDN。
