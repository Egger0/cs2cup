// ===================================================================
//  lc.js —— 腾讯云 CloudBase(PostgreSQL 版)数据层
//  公开页 index.html 与后台页 admin.html 共用。
//  依赖:先加载 cloudbase.full.js 和 config.js,再加载本文件。
//
//  设计:对外暴露后端无关的 window.LC 门面。页面代码不关心底层用的是
//        文档库还是 PostgreSQL;哪天再换后端,只改本文件。
//
//  数据表(在「SQL 编辑器」里跑 数据库初始化.sql 自动建好):
//    event —— 赛事信息(取最新一条)。列:id, data(jsonb), created_at
//    team  —— 报名战队。          列:id, data(jsonb), created_at
//    —— 所有业务字段都放在 data(jsonb)里,程序读写 data。
//
//  安全(RLS):
//    · 访客 = anon 角色(仅用 Publishable Key,不登录):可读公开资料、可调用受控报名 RPC
//    · 管理员 = authenticated 且 UID 在 cs2cup_admin 白名单:可管理赛事、完整报名与相册
//    公开页「绝不」匿名登录,以保证访客始终是 anon,无法删改数据。
// ===================================================================
(function () {
  "use strict";
  var CFG = window.LC_CONFIG || {};
  var CB = window.cloudbase || window.tcb; // UMD 全量包暴露的全局名
  var LC = (window.LC = { ready: false, reason: "", backend: "CloudBase-PostgreSQL" });

  function unset(v) { return !v || /粘贴|^在此/.test(v); }

  var app = null, rdb = null, auth = null;
  try {
    if (!CB) {
      LC.reason = "SDK 未加载(检查 cloudbase.full.js 是否成功引入)";
    } else if (unset(CFG.env) || unset(CFG.accessKey)) {
      LC.reason = "未配置(编辑 config.js 填入 环境ID 和 Publishable Key)";
    } else {
      app = CB.init({ env: CFG.env, accessKey: CFG.accessKey, region: CFG.region || "ap-shanghai" });
      rdb = app.rdb();                                             // PostgreSQL(PostgREST 风格)
      auth = (typeof app.auth === "function") ? app.auth() : app.auth;
      LC.ready = true;
    }
  } catch (e) {
    LC.reason = "初始化失败:" + ((e && e.message) ? e.message : e);
  }

  // rdb 的方法返回 { data, error };出错时抛异常,便于上层 .catch
  function rows(res) {
    if (res && res.error) {
      var er = res.error;
      var msg = er.message || er.msg || er.hint || (typeof er === "string" ? er : JSON.stringify(er));
      var e = new Error(msg); e.raw = er; throw e;
    }
    return (res && res.data) || [];
  }
  // auth 的方法也返回 { data, error }
  function authData(res) {
    if (res && res.error) {
      var msg = (res.error && (res.error.message || res.error.error_description)) || "操作失败";
      var e = new Error(msg); e.raw = res.error; throw e;
    }
    return res ? res.data : null;
  }
  function scalar(res) {
    if (res && res.error) {
      var er = res.error;
      var msg = er.message || er.msg || er.hint || (typeof er === "string" ? er : JSON.stringify(er));
      var e = new Error(msg); e.raw = er; throw e;
    }
    return res ? res.data : null;
  }

  // ---- 赛事信息(event 表)----
  // 取最新一条(按自增 id 最大)。返回 { id, ...业务字段 } 或 null
  LC.getEvent = function () {
    return Promise.resolve(rdb.from("event").select("*")).then(function (res) {
      var d = rows(res);
      if (!d.length) return null;
      var latest = d[0];
      for (var i = 1; i < d.length; i++) { if ((d[i].id || 0) > (latest.id || 0)) latest = d[i]; }
      return Object.assign({ id: latest.id }, latest.data || {});
    });
  };
  // existingId 有值则更新那条,否则新建;业务字段统一塞进 data(jsonb)
  LC.saveEvent = function (data, existingId) {
    var payload = {}; Object.keys(data).forEach(function (k) { payload[k] = data[k]; });
    if (existingId) {
      return Promise.resolve(rdb.from("event").update({ data: payload }).eq("id", existingId))
        .then(function (res) { rows(res); return existingId; });
    }
    return Promise.resolve(rdb.from("event").insert({ data: payload }).select())
      .then(function (res) { var d = rows(res); return (d[0] && d[0].id) || null; })
      .then(function (id) { return id != null ? id : LC.getEvent().then(function (ev) { return ev && ev.id; }); });
  };

  // ---- 报名战队(team 表)----
  // 公开页只读 team_public，不会获得队长和联系方式等私密字段。
  LC.listTeams = function () {
    return Promise.resolve(rdb.from("team_public").select("*")).then(function (res) {
      var d = rows(res).map(LC.plain);
      d.sort(function (a, b) { return (a.seed || 0) - (b.seed || 0); }); // 客户端排序,避免依赖 order() 语法
      return d;
    });
  };
  // 只有 SQL 白名单中的管理员能通过 RLS 读取完整报名资料。
  LC.listTeamsAdmin = function () {
    return Promise.resolve(rdb.from("team").select("*")).then(function (res) {
      var d = rows(res).map(LC.plain);
      d.sort(function (a, b) { return (a.seed || 0) - (b.seed || 0); });
      return d;
    });
  };
  LC.addTeam = function (data) {
    var payload = {}; Object.keys(data).forEach(function (k) { payload[k] = data[k]; });
    return Promise.resolve(rdb.rpc("cs2cup_submit_team", { p_team: payload }))
      .then(function (res) {
        var id = scalar(res);
        if (Array.isArray(id)) return (id[0] && (id[0].id || id[0].cs2cup_submit_team)) || null;
        return id;
      });
  };
  LC.updateTeam = function (id, data) {
    return Promise.resolve(rdb.from("team").update({ data: data }).eq("id", id)).then(rows);
  };
  LC.deleteTeam = function (id) {
    return Promise.resolve(rdb.from("team").delete().eq("id", id)).then(rows);
  };
  LC.countTeams = function () { return LC.listTeams().then(function (a) { return a.length; }); };

  // ---- 往届赛事相册(gallery 表)----
  // 每张照片一行,业务字段在 data 里:{ url, caption, edition, sort }
  // 届次文本 → 可排序的赛事时间(年*100+月,用于「时间越近越靠前」)。
  // 支持 "2025 秋季赛" / "2022第二届" / "2025-03" 等写法;解析不到年份返回 0(排到最后)。
  LC.editionTime = function (ed) {
    var s = String(ed || "");
    var m = s.match(/(19|20)\d{2}[-\/年](\d{1,2})/);
    var year = 0, mon = 0;
    if (m) {
      year = parseInt(m[0].slice(0, 4), 10);
      mon = Math.min(12, Math.max(1, parseInt(m[2], 10)));
    } else {
      var y = s.match(/(19|20)\d{2}/);
      if (y) {
        year = parseInt(y[0], 10);
        if (/春|spring/i.test(s)) mon = 3;
        else if (/夏|summer/i.test(s)) mon = 6;
        else if (/秋|autumn|fall/i.test(s)) mon = 9;
        else if (/冬|winter/i.test(s)) mon = 12;
      }
    }
    return year * 100 + mon;
  };
  LC.listGallery = function () {
    return Promise.resolve(rdb.from("gallery").select("*")).then(function (res) {
      var d = rows(res).map(LC.plainPhoto);
      // 先按「赛事时间」倒序(时间越近越靠前),同一赛事内再按 sort 倒序(新上传的在前)。
      d.sort(function (a, b) {
        var ea = LC.editionTime(a.edition), eb = LC.editionTime(b.edition);
        if (ea !== eb) return eb - ea;
        return (b.sort || 0) - (a.sort || 0);
      });
      return d;
    });
  };
  LC.addGallery = function (data) {
    var payload = {}; Object.keys(data).forEach(function (k) { payload[k] = data[k]; });
    return Promise.resolve(rdb.from("gallery").insert({ data: payload }).select())
      .then(function (res) { var d = rows(res); return (d[0] && d[0].id) || null; });
  };
  LC.updateGallery = function (id, data) {
    return Promise.resolve(rdb.from("gallery").update({ data: data }).eq("id", id)).then(rows);
  };
  LC.deleteGallery = function (id) {
    return Promise.resolve(rdb.from("gallery").delete().eq("id", id)).then(rows);
  };
  // 一行 gallery 记录 -> 普通对象
  LC.plainPhoto = function (row) {
    var d = row.data || {};
    return {
      id: row.id,
      url: d.url || "", caption: d.caption || "", edition: d.edition || "",
      sort: d.sort || 0,
      createdAt: row.created_at ? new Date(row.created_at) : null
    };
  };

  // 一行 team 记录 -> 普通对象(业务字段在 data 里)
  LC.plain = function (row) {
    var d = row.data || {};
    return {
      id: row.id,
      name: d.name, tag: d.tag, captain: d.captain, contact: d.contact,
      dept: d.dept || "", players: d.players || [], note: d.note || "",
      seed: d.seed,
      createdAt: row.created_at ? new Date(row.created_at) : null
    };
  };

  // ---- 管理员鉴权(邮箱 + 密码；数据库再校验管理员 UID)----
  LC.login = function (email, password) {
    return Promise.resolve(auth.signInWithPassword({ email: email, password: password })).then(authData);
  };
  LC.logout = function () { return Promise.resolve(auth.signOut()); };

  // 公开页不需要登录:访客用 Publishable Key 以 anon 角色访问即可。
  // 这里保留匿名登录能力但「默认不调用」——ensureAuth 特意做成空操作,
  // 以免把访客升级成 authenticated 角色而获得删改权限。
  LC.signInAnonymously = function () {
    return Promise.resolve(auth.signInAnonymously()).then(authData);
  };
  LC.ensureAuth = function () { return Promise.resolve(null); };

  LC.getUser = function () {
    return Promise.resolve(auth.getUser())
      .then(function (res) { var d = authData(res); return (d && d.user) ? d.user : null; })
      .catch(function () { return null; });
  };
  LC.getSession = function () {
    return Promise.resolve(auth.getSession())
      .then(function (res) { var d = authData(res); return (d && d.session) ? d.session : null; })
      .catch(function () { return null; });
  };
  LC.isAdmin = function () {
    return LC.getUser().then(function (user) {
      var id = user && (user.id || user.uid || user.sub);
      if (!id) return false;
      return Promise.resolve(rdb.from("cs2cup_admin").select("user_id").eq("user_id", id))
        .then(function (res) { return rows(res).length > 0; });
    });
  };
})();
