// ===================================================================
//  腾讯云 CloudBase(云开发)配置  —— 只需改这一个文件
// ===================================================================
//  控制台:https://tcb.cloud.tencent.com/dev
//
//  1) 环境 ID(env):控制台首页 → 你的环境,标题下方那串,形如 xxx-1a2b3c4d
//  2) Publishable Key(accessKey):控制台 → 环境 → API Key
//        (https://tcb.cloud.tencent.com/dev#/env/apikey)点「新建」生成。
//        · 它是「客户端公钥」,官方说明【可以安全暴露在前端网页里】,没有安全问题。
//        · ⚠️ 千万不要把腾讯云账号的 SecretId / SecretKey(私钥)填到这里!
//          那是账号级私钥,泄露=整个云账号被控。这里只放环境的 Publishable Key。
//  3) region(地域):上海填 ap-shanghai,广州 ap-guangzhou,新加坡 ap-singapore
//        —— 以你创建环境时选的地域为准(控制台环境信息里能看到)。
// ===================================================================

window.LC_CONFIG = {
  env:       "nbt-cs2cup-d8g55pvj062a9ece2",          // 例:cs2cup-1a2b3c4d
  accessKey: "eyJhbGciOiJSUzI1NiIsImtpZCI6ImEyN2FkMWMyLTM3OTUtNDViMS1iZWFjLWQ1MzdhNzgwYTEwMSJ9.eyJpc3MiOiJodHRwczovL25idC1jczJjdXAtZDhnNTVwdmowNjJhOWVjZTIuYXAtc2hhbmdoYWkudGNiLWFwaS50ZW5jZW50Y2xvdWRhcGkuY29tIiwic3ViIjoiYW5vbiIsImF1ZCI6Im5idC1jczJjdXAtZDhnNTVwdmowNjJhOWVjZTIiLCJleHAiOjQwOTEzMjAwNzcsImlhdCI6MTc4NzYzNjg3Nywibm9uY2UiOiJGNDRjdlFzVFNTZWh3U2JUOHVpaFZ3IiwiYXRfaGFzaCI6IkY0NGN2UXNUU1NlaHdTYlQ4dWloVnciLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoibmJ0LWNzMmN1cC1kOGc1NXB2ajA2MmE5ZWNlMiIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJyb2xlIjoiYW5vbiIsImlzX2Fub255bW91cyI6dHJ1ZSwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiYW5vbnltb3VzIiwicHJvdmlkZXJzIjpbImFub255bW91cyJdfSwidXNlcl9tZXRhZGF0YSI6eyJuYW1lIjoiQW5vbnltb3VzIn0sInVzZXJfdHlwZSI6IiIsImNsaWVudF90eXBlIjoiY2xpZW50X3VzZXIiLCJpc19zeXN0ZW1fYWRtaW4iOmZhbHNlfQ.bMMkesEAO8dGZNJlxWXKKMy5v_2icLH4XP8aQSFJXvN5W7073OVR8Qf92KAZoWvBgd33Mr90YHVXLSVhcTHGE0SbtjLXpap5pVmwgpi0H_IX00s4RREQSdMmlvrw2SCc1he8FSXCQh4EHzt0M81PT1ZvoW9X427Ywgk1UPVyjq50tiyuh2AKXIcXsEU_TnoWYrSfw-X0ZhTHoclttsPXdWEtAwOdE6LUA-CC4Y5SWw14KtHR4GiU3pxLRlsjcLCng5lsPJ6q5YnSi-tVSNFzQMvzwHvpDP3QyT4nIwvExoOJwvQ6KzunQJWKsUT2k35gG40Db-xOHgjn_NdkY4Shqg", // 例:xxxxxxxx-xxxx-xxxx-...
  region:    "ap-shanghai"               // 你环境所在地域
};
