/* 家计簿 — offline bookkeeping web app. Data lives only in this browser (localStorage). */
'use strict';
(() => {
  const APP_VERSION = '1.0.16';
  const STORE_KEY = 'kakeibo:data';
  const PREV_KEY = 'kakeibo:data:prev';
  const UI_KEY = 'kakeibo:ui';

  /* ================= helpers ================= */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  /* ids are written into the page's HTML, so only plain ones are accepted */
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const curMonth = () => todayStr().slice(0, 7);
  const addMonths = (ym, n) => {
    let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + n;
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
    return `${y}-${pad2(m)}`;
  };
  const monthEnd = (ym) => `${ym}-${pad2(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate())}`;
  const monthsBetween = (a, b) => { const out = []; let m = a, g = 0; while (m <= b && g++ < 600) { out.push(m); m = addMonths(m, 1); } return out; };
  const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEK = {
    zh: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
    ja: ['日', '月', '火', '水', '木', '金', '土'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  };
  /* "2026年10月" / "Oct 2026" and the short "10月" / "Oct" used on chart axes */
  const ymLabel = (ym) => { const y = ym.slice(0, 4), m = Number(ym.slice(5, 7)); return LANG === 'en' ? `${MON_EN[m - 1]} ${y}` : `${y}年${m}月`; };
  const monShort = (ym) => { const m = Number(ym.slice(5, 7)); return LANG === 'en' ? MON_EN[m - 1] : `${m}月`; };
  const parseYMD = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  const dayDiff = (s) => Math.round((parseYMD(s) - parseYMD(todayStr())) / 86400000);
  const relDay = (s) => { const dd = dayDiff(s); return dd === 0 ? tr('today') : dd === -1 ? tr('yesterday') : dd === 1 ? tr('tomorrow') : ''; };
  /* "10/24 周六" · "10/24(土)" · "Sat, Oct 24" */
  const mdw = (s) => {
    const d = parseYMD(s), m = d.getMonth() + 1, w = WEEK[LANG][d.getDay()];
    return LANG === 'en' ? `${w}, ${MON_EN[m - 1]} ${d.getDate()}` : LANG === 'ja' ? `${m}/${d.getDate()}(${w})` : `${m}/${d.getDate()} ${w}`;
  };
  const dayLabel = (s) => {
    const d = parseYMD(s), m = d.getMonth() + 1, w = WEEK[LANG][d.getDay()];
    const base = LANG === 'en' ? `${w}, ${MON_EN[m - 1]} ${d.getDate()}` : LANG === 'ja' ? `${m}月${d.getDate()}日(${w})` : `${m}月${d.getDate()}日 ${w}`;
    const r = relDay(s);
    return r ? `${r} · ${base}` : base;
  };
  const shortDate = (s) => {
    const dd = dayDiff(s), r = dd === 0 || dd === -1 ? relDay(s) : '';
    if (!r) return mdw(s);
    if (LANG === 'en') { const d = parseYMD(s); return `${r}, ${MON_EN[d.getMonth()]} ${d.getDate()}`; }
    return `${r} ${mdw(s)}`;
  };
  const fmt = (n) => Math.abs(Math.round(n)).toLocaleString('ja-JP');
  const yen = (n) => (n < 0 ? '−¥' : '¥') + fmt(n);
  const yenSigned = (n) => (n > 0 ? '+¥' : n < 0 ? '−¥' : '¥') + fmt(n);
  /* "-1,234" → -1234; null when the field is empty */
  const readSigned = (s) => {
    s = String(s || '').trim();
    if (!/\d/.test(s)) return null;
    return (parseInt(s.replace(/[^\d]/g, ''), 10) || 0) * (/^[-−－]/.test(s) ? -1 : 1);
  };
  const signedStr = (n) => (n ? (n < 0 ? '-' : '') + fmt(n) : '');
  const pct = (v, t) => (t ? (v / t) * 100 : 0).toFixed(1) + '%';
  const trimNum = (x) => String(x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
  const compact = (n) => {
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (LANG === 'en') {
      if (a >= 1e6) return s + trimNum(a / 1e6) + 'M';
      if (a >= 1e3) return s + trimNum(a / 1e3) + 'k';
      return s + Math.round(a).toLocaleString('en-US');
    }
    if (a >= 1e8) return s + trimNum(a / 1e8) + (LANG === 'ja' ? '億' : '亿');
    if (a >= 1e4) return s + trimNum(a / 1e4) + '万';
    return s + Math.round(a).toLocaleString('ja-JP');
  };
  const niceMax = (v) => {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  };
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  /* ================= languages ================= */
  /* Category and account names are the user's own data and are never translated.
     Keys ending in "1" are English singular forms picked when params.n === 1. */
  const I18N = {
    zh: {
      'app.name': '家计簿', 'nav.label': '主菜单',
      'tab.home': '家计', 'tab.list': '明细', 'tab.assets': '资产', 'tab.settings': '设置',
      'kind.out': '支出', 'kind.in': '收入', 'kind.move': '转移',
      'type.bank': '银行', 'type.cash': '现金', 'type.ewallet': '电子钱包', 'type.credit': '信用卡', 'type.securities': '证券', 'type.other': '其他',
      'today': '今天', 'yesterday': '昨天', 'tomorrow': '明天', 'future': '预定',
      'month.prev': '上个月', 'month.next': '下个月',
      'common.save': '保存', 'common.cancel': '取消', 'common.ok': '确定', 'common.delete': '删除', 'common.undo': '撤销', 'common.close': '关闭',
      'common.add': '＋ 添加', 'common.name': '名称', 'common.saved': '已保存', 'common.undone': '已撤销', 'common.enterName': '请输入名称',
      'common.hide': '停用（不在选择列表里出现）', 'common.hiddenTag': '已停用', 'common.up': '上移', 'common.down': '下移', 'common.movedUp': '已上移', 'common.movedDown': '已下移',
      'count': '{n} 笔', 'uncat': '未分类', 'other': '其他', 'deleted': '（已删除）', 'deletedAcc': '（已删除账户）',
      'owed': '待还', 'balance': '余额', 'prev.month': '上月 {v}',
      'saveFail': '保存失败：存储空间可能不足',
      'welcome.title': '👋 欢迎使用家计簿',
      'welcome.text': '数据只保存在这台手机上，没网也能用。先在「设置」里把账户改成你自己的，填好现在的余额；有备份的话也可以直接导入。',
      'welcome.setup': '设置账户', 'welcome.import': '导入备份',
      'nudge.never': '还没有备份过', 'nudge.days': '已经 {n} 天没有备份了', 'nudge.btn': '备份',
      'home.spendThis': '本月支出', 'home.spendIn': '{m}支出', 'home.net': '收支',
      'comp.title': '{k}构成', 'comp.total': '{k}合计', 'comp.empty': '这个月还没有{k}记录',
      'trend.title': '{k}推移', 'trend.tap': '点柱子看金额', 'trend.avg': '月平均（虚线）', 'trend.aria': '月度推移',
      'trend.wait': '记满两个月后，这里会显示每个月的柱状图和月平均。',
      'recent.title': '最近明细', 'recent.all': '查看全部明细 ›', 'recent.empty': '点下面的 ＋ 记第一笔',
      'list.all': '全部', 'list.category': '分类', 'list.account': '账户', 'list.empty': '{m}没有符合条件的记录',
      'card.usage': '本月刷卡 {a} · 上月 {b}',
      'assets.asOf': '截至 {d}', 'assets.net': '净资产（已扣信用卡待还）', 'assets.delta': '较上月底 {v}', 'assets.assets': '资产', 'assets.debt': '负债（信用卡待还）',
      'assets.future': '另有 {n} 笔未来日期的记录，到那天才会计入余额。', 'assets.noAcc': '还没有账户，去「设置」添加',
      'assets.trend': '净资产推移', 'assets.monthEnd': '每月月底', 'assets.trendWait': '从下个月开始，这里会显示每个月月底的净资产。',
      'assets.comp': '资产构成', 'assets.noPositive': '还没有正余额的账户',
      'assets.accounts': '账户', 'sort.btn': '排序', 'sort.title': '调整账户顺序', 'sort.done': '完成', 'sort.saved': '顺序已保存',
      'sort.hint': '按住右边的 ≡ 上下拖动，可以调整分组的顺序，也可以调整分组里每个账户的顺序。记一笔、设置和资产页都按这个顺序显示。',
      'sort.dragGroup': '拖动调整分组顺序', 'sort.dragItem': '拖动调整顺序',
      'set.accounts': '账户', 'set.noAcc': '还没有账户',
      'set.cardHint': '信用卡的余额是负数，表示还没还的钱。还卡时记一笔「转移」：转出选银行，转入选信用卡。',
      'set.categories': '分类', 'set.noCat': '还没有分类', 'set.addOut': '＋ 添加支出分类', 'set.addIn': '＋ 添加收入分类',
      'set.prefs': '使用习惯', 'set.autoAdd': '打开 App 时直接进入「记一笔」', 'set.autoOn': '下次打开会直接进入「记一笔」', 'set.autoOff': '已关闭',
      'set.backup': '备份', 'set.bNever': '还没有备份过', 'set.bLast': '上次备份：', 'set.bToday': '今天', 'set.bDays': '{n} 天前',
      'set.export': '导出备份文件', 'set.copy': '复制备份文本', 'set.importFile': '从文件导入（备份 / CSV）', 'set.paste': '粘贴文本导入', 'set.csv': '导出明细 CSV',
      'set.backupHint': '数据只保存在这台手机上。删掉主屏幕上的图标会连数据一起删掉，建议每个月导出一次备份，存到「ファイル」或网盘里。',
      'set.lang': '语言', 'set.langDone': '已切换为中文',
      'about': '家计簿 · 版本 {v}', 'persist.yes': '本机存储：已设为持久保存', 'persist.no': '本机存储：普通',
      'entry.new': '记一笔', 'entry.edit': '编辑', 'entry.from': '转出（钱从哪里出）', 'entry.to': '转入（钱到哪里去）',
      'entry.noCat': '先在「设置」里添加分类', 'entry.noAcc': '先在「设置」里添加账户', 'entry.received': '入账账户', 'entry.paid': '支付方式',
      'entry.date': '日期', 'entry.memo': '备注（可选）', 'entry.saveCont': '保存并继续',
      'entry.needAmount': '请输入金额', 'entry.needCat': '请选择分类', 'entry.needFrom': '请选择转出账户', 'entry.needAcc': '请选择账户',
      'entry.needTo': '请选择转入账户', 'entry.same': '转出和转入不能是同一个账户',
      'entry.savedCont': '已记下 {w}，继续记下一笔', 'entry.savedEdit': '已保存修改', 'entry.saved': '已记下 {w}',
      'entry.delAsk': '删除这条记录？', 'entry.deleted': '已删除', 'entry.restored': '已恢复',
      'acc.add': '添加账户', 'acc.edit': '编辑账户', 'acc.namePh': '例如：三菱UFJ銀行', 'acc.type': '类型',
      'acc.balNow': '现在的余额', 'acc.oweNow': '现在的待还金额',
      'acc.balHint': '今天这个账户里实际有多少钱（看银行或钱包 App）。',
      'acc.oweHint': '打开信用卡 App，看现在还没还的金额，填正数。之后刷卡会自动累加，还卡时记一笔「转移」。',
      'acc.adjSwitch': '差额记为特殊收入 / 支出', 'acc.adjSwitchSub': '关掉的话直接改开始时的余额，不算收支（适合第一次设置）',
      'acc.dupe': '已经有同名账户', 'acc.inUse': '有 {n} 笔记录用到这个账户，不能删除，可以改成「停用」', 'acc.delAsk': '删除这个账户？',
      'adj.more': '比记录多 {v}', 'adj.less': '比记录少 {v}', 'adj.oweMore': '待还比记录多 {v}', 'adj.oweLess': '待还比记录少 {v}',
      'adj.book': '，保存后记一笔今天的「{c}」', 'adj.initial': '，保存后直接改开始时的余额，不算收支', 'adj.done': '已记一笔今天的{c} {v}',
      'cat.add': '添加分类', 'cat.edit': '编辑分类', 'cat.kind': '收支', 'cat.locked': '（已有记录，不能更改）', 'cat.namePh': '例如：咖啡',
      'name.hint': '只改{l}界面显示的名称，其他语言的名称不变。', 'name.hintNew': '其他语言还没单独改名之前，也会显示这个名称。',
      'cat.icon': '图标（点下面选，或输入任意表情）',
      'cat.dupe': '已经有同名分类', 'cat.inUse': '有 {n} 笔记录用到这个分类，不能删除，可以改成「停用」', 'cat.delAsk': '删除这个分类？',
      'bk.exported': '备份已导出', 'bk.copied': '备份文本已复制，可以粘贴到备忘录或聊天里保存', 'bk.csvDone': 'CSV 已导出',
      'imp.noCols': 'CSV 里找不到「日期」「金额」这两列', 'imp.empty': '内容是空的', 'imp.broken': '备份内容不完整，无法读取', 'imp.notOurs': '这不是家计簿的备份',
      'imp.replaceAsk': '用这个备份覆盖当前数据？\n备份里有 {e} 笔记录、{a} 个账户、{c} 个分类。', 'imp.replaceBtn': '覆盖导入', 'imp.replaced': '已导入 {n} 笔记录',
      'imp.badCsv': 'CSV 格式不对', 'imp.noRows': 'CSV 里没有可以导入的记录', 'imp.newItems': '\n会新建 {c} 个分类、{a} 个账户。',
      'imp.appendAsk': '从 CSV 追加 {n} 笔记录？', 'imp.skip': '\n有 {n} 行看不懂，会跳过。', 'imp.appendBtn': '追加导入', 'imp.appended': '已追加 {n} 笔记录',
      'imp.readFail': '读取文件失败',
      'paste.export': '备份文本', 'paste.import': '粘贴文本导入', 'paste.go': '导入',
      'paste.exportLabel': '长按全选后复制，保存到备忘录或聊天里', 'paste.importLabel': '把备份文本或 CSV 粘贴到这里',
      'paste.hint': '备份文本（以 { 开头）会覆盖当前数据；CSV（日期,内容,金额,收支,分类,支付方式,备注）会追加到现有记录后面。',
      'sw.ready': '新版本已下载，关闭当前页面后更新',
      'ai.scan': '拍小票', 'ai.busy': '识别中…', 'ai.title': '拍照识别（AI）', 'ai.setup': '设置密钥', 'ai.change': '更换或删除密钥',
      'ai.on': '已设置 Gemini 密钥。在「记一笔」里点「📷 拍小票」，就能用照片自动填写。',
      'ai.off': '拍小票，或选付款记录的截图（PayPay、微信支付都行，可以一次选多张，长截图也可以）。AI 会填好金额、日期、店名和分类，你确认后再保存。需要一个免费的 Gemini API 密钥。',
      'ai.setupTitle': 'Gemini 密钥', 'ai.keyLabel': 'API 密钥', 'ai.remove': '删除密钥',
      'ai.step1': '用 Google 账号打开下面的网址，生成一个 API 密钥。', 'ai.step2': '复制密钥，粘贴到下面，点右上角「保存」。',
      'ai.privacy': '密钥只保存在这台手机上，不会写进备份文件。识别时，照片和你的分类、账户名称会发送给 Google；免费额度下，Google 可能用这些内容改进产品，也可能有人工查看。支出和收入的支付方式不会被 AI 改，还是你自己选；チャージ 这类转移的账户由 AI 推测，可以改。',
      'ai.saved': '已保存，可以拍小票了', 'ai.savedUnchecked': '已保存（现在连不上网，没检查密钥）', 'ai.removed': '已删除密钥',
      'ai.badKey': '这个密钥用不了，请重新复制粘贴', 'ai.enterKey': '请粘贴 API 密钥', 'ai.checking': '正在检查密钥…',
      'ai.done': '已按照片填好，确认后保存', 'ai.noAmount': '没认出金额，可以重拍或手动输入', 'ai.offline': '没有网络，联网后再试',
      'ai.quota': '免费额度暂时用完了，过一会儿再试', 'ai.failed': '识别失败：{m}', 'ai.timeout': '识别超时了，请再试一次', 'ai.badImage': '这张图片打不开',
      'ai.doneSkip': '已按照片填好，确认后保存（已跳过：{s}）',
      'scan.found': '识别到 {n} 笔', 'scan.add': '添加 {n} 笔', 'scan.added': '已添加 {n} 笔', 'scan.undone': '已撤销',
      'scan.same': '这天已有同金额：{w}', 'scan.twin': '和上面一笔日期、金额相同', 'scan.from': '转出账户', 'scan.to': '转入账户', 'scan.needMove': '勾选的转移还没选好转出和转入账户',
      'scan.noDate': '没认出日期，请确认', 'scan.pickCat': '选择分类', 'scan.needCat': '勾选的项目里还有没选分类的',
      'scan.skipped': '已跳过：{s}', 'scan.none': '没有可以记的收支（已跳过：{s}）', 'scan.sep': '、',
      'scan.hint': '支出和收入记到上面选的支付方式，转移按每笔选的账户记。金额和备注可以保存后在「明细」里改。',
      'ai.tooMany': '一次最多选 {n} 张', 'ai.tooLong': '图片太多或太长了，请分几次识别',
      'dup.ask': '{d} 已经有一笔同样金额的记录：{w}。还要再记一笔吗？', 'dup.go': '仍然记',
      'scan.title': 'AI 识别', 'ss.prep': '处理图片', 'ss.upload': '上传', 'ss.ai': 'AI 识别',
      'ss.prepDone': '{n} 张', 'ss.prepSlices': '{n} 张 · 长图切成 {p} 段', 'ss.prepSkip': '{n} 张打不开，已跳过',
      'ss.upPct': '{p}% · {a} / {b}', 'ss.wait': '{m} · 等待回复 {s} 秒', 'ss.recv': '已识别 {n} 笔 · {s} 秒', 'ss.done': '完成 · {s} 秒',
      'ss.switch': '{a} 暂时用不了（{c}），改用 {b}', 'ss.slowSwitch': '{a} {s} 秒没回复，改用 {b}', 'ss.noThink': '这个模型不支持思考设置，已重新发送',
      'ss.waiting': '识别出的会一条一条出现在这里', 'ss.none': '没有可以记的收支',
      'ss.stallUp': '上传卡住了，网络可能不好', 'ss.stallAi': 'AI {s} 秒没有回复', 'ss.net': '网络连接断了',
      'ss.cut': '已识别的可以先添加，也可以重试。', 'ss.retry': '重试', 'ss.fill': '填到记一笔里改',
      'scan.discard': '识别结果还没添加，要放弃吗？', 'scan.discardBtn': '放弃',
      'aa.people': '{n} 人', 'aa.mine': '我的 {v}', 'aa.title': 'AA · {n} 人', 'aa.total': '总额 {v} · 用「{a}」支付', 'aa.others': '其他 {n} 人还给你的钱',
      'aa.who': '朋友 {i}', 'aa.accPh': '收款方式', 'aa.mineBox': '我的部分 {v}，记为「{c}」支出', 'aa.amtLabel': '金额',
      'aa.note': '朋友还的钱记成从「{a}」到收款账户的转移，不算收入也不算支出，并标记为 AA。还到「{a}」本身的不另记。',
      'aa.needAcc': '请给每个人选收款方式', 'aa.needAmt': '请填写每个人的金额', 'aa.tooMuch': '朋友的合计不能超过总额',
      'aa.saved': '已记下 AA：我的部分 {v}（共 {t} · {n} 人）', 'aa.over': '我的部分 ¥0。多出的 {x} 只进收款账户的余额，不算收入也不算支出', 'aa.extra': 'AA 多收', 'aa.extraCsv': '（AA 多收，不计入收支）', 'aa.delExtra': '删除这笔 AA 多收？', 'aa.sub': '{n}人 · 共{t}', 'aa.delAsk': '删除这笔 AA？相关的 {k} 笔（朋友还款）也会一起删除。',
      'aa.descT': '（AA 共{t}）', 'scan.aaSame': '可能是已记的 AA 回款：{w}',
      'scan.sk.points': '积分 {n} 笔', 'scan.sk.failed': '失败/取消 {n} 笔', 'scan.sk.foreign': '没有日元金额 {n} 笔',
    },
    ja: {
      'app.name': '家計簿', 'nav.label': 'メインメニュー',
      'tab.home': '家計', 'tab.list': '明細', 'tab.assets': '資産', 'tab.settings': '設定',
      'kind.out': '支出', 'kind.in': '収入', 'kind.move': '振替',
      'type.bank': '銀行', 'type.cash': '現金', 'type.ewallet': '電子マネー', 'type.credit': 'クレジットカード', 'type.securities': '証券', 'type.other': 'その他',
      'today': '今日', 'yesterday': '昨日', 'tomorrow': '明日', 'future': '予定',
      'month.prev': '前の月', 'month.next': '次の月',
      'common.save': '保存', 'common.cancel': 'キャンセル', 'common.ok': 'OK', 'common.delete': '削除', 'common.undo': '元に戻す', 'common.close': '閉じる',
      'common.add': '＋ 追加', 'common.name': '名前', 'common.saved': '保存しました', 'common.undone': '取り消しました', 'common.enterName': '名前を入力してください',
      'common.hide': '非表示（選択肢に出さない）', 'common.hiddenTag': '非表示', 'common.up': '上へ', 'common.down': '下へ', 'common.movedUp': '上に移動しました', 'common.movedDown': '下に移動しました',
      'count': '{n}件', 'uncat': '未分類', 'other': 'その他', 'deleted': '（削除済み）', 'deletedAcc': '（削除された口座）',
      'owed': '未払い', 'balance': '残高', 'prev.month': '先月 {v}',
      'saveFail': '保存できませんでした（空き容量が足りない可能性があります）',
      'welcome.title': '👋 家計簿へようこそ',
      'welcome.text': 'データはこのスマホの中だけに保存され、オフラインでも使えます。まず「設定」で口座を自分用に変えて、今の残高を入力してください。バックアップがあればそのまま読み込めます。',
      'welcome.setup': '口座を設定', 'welcome.import': 'バックアップを読み込む',
      'nudge.never': 'まだバックアップしていません', 'nudge.days': '{n}日間バックアップしていません', 'nudge.btn': 'バックアップ',
      'home.spendThis': '今月の支出', 'home.spendIn': '{m}の支出', 'home.net': '収支',
      'comp.title': '{k}の内訳', 'comp.total': '{k}合計', 'comp.empty': '今月の{k}はまだありません',
      'trend.title': '{k}の推移', 'trend.tap': 'バーをタップで金額表示', 'trend.avg': '月平均（点線）', 'trend.aria': '月ごとの推移',
      'trend.wait': '2か月分記録すると、月ごとの棒グラフと月平均がここに表示されます。',
      'recent.title': '最近の明細', 'recent.all': 'すべての明細を見る ›', 'recent.empty': '下の ＋ から最初の記録をどうぞ',
      'list.all': 'すべて', 'list.category': 'カテゴリ', 'list.account': '口座', 'list.empty': '{m}に該当する記録はありません',
      'card.usage': '今月の利用 {a} · 先月 {b}',
      'assets.asOf': '{d}時点', 'assets.net': '純資産（カードの未払いを差し引き）', 'assets.delta': '先月末比 {v}', 'assets.assets': '資産', 'assets.debt': '負債（カードの未払い）',
      'assets.future': '未来の日付の記録が{n}件あります。その日になると残高に反映されます。', 'assets.noAcc': '口座がありません。「設定」で追加してください',
      'assets.trend': '純資産の推移', 'assets.monthEnd': '各月末', 'assets.trendWait': '来月から、毎月末の純資産がここに表示されます。',
      'assets.comp': '資産の内訳', 'assets.noPositive': 'プラス残高の口座はまだありません',
      'assets.accounts': '口座', 'sort.btn': '並べ替え', 'sort.title': '口座の並べ替え', 'sort.done': '完了', 'sort.saved': '並び順を保存しました',
      'sort.hint': '右の ≡ を押したまま上下にドラッグすると、グループの順番も、グループ内の口座の順番も変えられます。入力画面・設定・資産ページはこの順番で表示されます。',
      'sort.dragGroup': 'ドラッグしてグループを並べ替え', 'sort.dragItem': 'ドラッグして並べ替え',
      'set.accounts': '口座', 'set.noAcc': '口座がありません',
      'set.cardHint': 'クレジットカードの残高はマイナス（未払い分）で表示されます。カードを支払ったら「振替」で、振替元に銀行、振替先にカードを選んで記録します。',
      'set.categories': 'カテゴリ', 'set.noCat': 'カテゴリがありません', 'set.addOut': '＋ 支出カテゴリを追加', 'set.addIn': '＋ 収入カテゴリを追加',
      'set.prefs': '使い方', 'set.autoAdd': 'アプリを開いたらすぐ「入力」画面にする', 'set.autoOn': '次回から開くとすぐ「入力」画面になります', 'set.autoOff': 'オフにしました',
      'set.backup': 'バックアップ', 'set.bNever': 'まだバックアップしていません', 'set.bLast': '前回のバックアップ：', 'set.bToday': '今日', 'set.bDays': '{n}日前',
      'set.export': 'バックアップを書き出す', 'set.copy': 'バックアップをテキストでコピー', 'set.importFile': 'ファイルから読み込む',
      'set.paste': 'テキストを貼り付けて読み込む', 'set.csv': '明細をCSVで書き出す',
      'set.backupHint': 'データはこのスマホの中だけに保存されます。ホーム画面のアイコンを削除するとデータも消えるので、月に一度はバックアップを書き出して「ファイル」やクラウドに保存しておきましょう。',
      'set.lang': '言語', 'set.langDone': '日本語に切り替えました',
      'about': '家計簿 · バージョン {v}', 'persist.yes': '端末内の保存：永続化済み', 'persist.no': '端末内の保存：通常',
      'entry.new': '入力', 'entry.edit': '編集', 'entry.from': '振替元（お金が出る口座）', 'entry.to': '振替先（お金が入る口座）',
      'entry.noCat': '先に「設定」でカテゴリを追加してください', 'entry.noAcc': '先に「設定」で口座を追加してください', 'entry.received': '入金先', 'entry.paid': '支払い方法',
      'entry.date': '日付', 'entry.memo': 'メモ（任意）', 'entry.saveCont': '保存して続ける',
      'entry.needAmount': '金額を入力してください', 'entry.needCat': 'カテゴリを選んでください', 'entry.needFrom': '振替元を選んでください', 'entry.needAcc': '口座を選んでください',
      'entry.needTo': '振替先を選んでください', 'entry.same': '振替元と振替先が同じ口座です',
      'entry.savedCont': '{w} を記録しました。続けて入力できます', 'entry.savedEdit': '変更を保存しました', 'entry.saved': '{w} を記録しました',
      'entry.delAsk': 'この記録を削除しますか？', 'entry.deleted': '削除しました', 'entry.restored': '元に戻しました',
      'acc.add': '口座を追加', 'acc.edit': '口座を編集', 'acc.namePh': '例：三菱UFJ銀行', 'acc.type': '種類',
      'acc.balNow': '現在の残高', 'acc.oweNow': '現在の未払い額',
      'acc.balHint': '今日この口座に実際にいくらあるか（銀行や電子マネーのアプリで確認）。',
      'acc.oweHint': 'カード会社のアプリで今の未払い額を確認し、プラスの数字で入力します。カードで払うと自動で増え、支払ったら「振替」で記録します。',
      'acc.adjSwitch': '差額を特殊収入 / 特殊支出として記録', 'acc.adjSwitchSub': 'オフにすると開始時の残高だけを変更し、収支には含めません（初回設定向け）',
      'acc.dupe': '同じ名前の口座があります', 'acc.inUse': 'この口座を使っている記録が{n}件あるため削除できません。「非表示」にできます', 'acc.delAsk': 'この口座を削除しますか？',
      'adj.more': '記録より {v} 多い', 'adj.less': '記録より {v} 少ない', 'adj.oweMore': '未払いが記録より {v} 多い', 'adj.oweLess': '未払いが記録より {v} 少ない',
      'adj.book': '。保存すると今日の「{c}」として記録します', 'adj.initial': '。保存すると開始時の残高だけを変更し、収支には含めません', 'adj.done': '今日の{c} {v} を記録しました',
      'cat.add': 'カテゴリを追加', 'cat.edit': 'カテゴリを編集', 'cat.kind': '収支', 'cat.locked': '（記録があるため変更できません）', 'cat.namePh': '例：カフェ',
      'name.hint': '{l}表示の名前だけが変わります。ほかの言語の名前はそのままです。', 'name.hintNew': 'ほかの言語で名前を付けるまでは、この名前が表示されます。',
      'cat.icon': 'アイコン（下から選ぶか、好きな絵文字を入力）',
      'cat.dupe': '同じ名前のカテゴリがあります', 'cat.inUse': 'このカテゴリを使っている記録が{n}件あるため削除できません。「非表示」にできます', 'cat.delAsk': 'このカテゴリを削除しますか？',
      'bk.exported': 'バックアップを書き出しました', 'bk.copied': 'バックアップをコピーしました。メモやチャットに貼り付けて保存できます', 'bk.csvDone': 'CSVを書き出しました',
      'imp.noCols': 'CSVに「日期」「金额」の列が見つかりません', 'imp.empty': '内容が空です', 'imp.broken': 'バックアップが不完全で読み込めません', 'imp.notOurs': '家計簿のバックアップではありません',
      'imp.replaceAsk': 'このバックアップで今のデータを上書きしますか？\n記録 {e}件、口座 {a}件、カテゴリ {c}件が含まれています。', 'imp.replaceBtn': '上書きして読み込む', 'imp.replaced': '{n}件の記録を読み込みました',
      'imp.badCsv': 'CSVの形式が正しくありません', 'imp.noRows': 'CSVに読み込める記録がありません', 'imp.newItems': '\nカテゴリ {c}件・口座 {a}件を新しく作成します。',
      'imp.appendAsk': 'CSVから{n}件の記録を追加しますか？', 'imp.skip': '\n読み取れない{n}行はスキップします。', 'imp.appendBtn': '追加する', 'imp.appended': '{n}件の記録を追加しました',
      'imp.readFail': 'ファイルを読み込めませんでした',
      'paste.export': 'バックアップ（テキスト）', 'paste.import': 'テキストを貼り付けて読み込む', 'paste.go': '読み込む',
      'paste.exportLabel': '長押しで全選択してコピーし、メモやチャットに保存してください', 'paste.importLabel': 'バックアップのテキストまたはCSVをここに貼り付け',
      'paste.hint': 'バックアップ（{ で始まるテキスト）は今のデータを上書きします。CSV（日期,内容,金额,收支,分类,支付方式,备注）は今の記録に追加されます。',
      'sw.ready': '新しいバージョンをダウンロードしました。この画面を閉じると更新されます',
      'ai.scan': 'レシート撮影', 'ai.busy': '読み取り中…', 'ai.title': 'レシート読み取り（AI）', 'ai.setup': 'キーを設定', 'ai.change': 'キーの変更・削除',
      'ai.on': 'Gemini のキーを設定済みです。入力画面の「📷 レシート撮影」から、写真で自動入力できます。',
      'ai.off': 'レシートを撮るか、支払い履歴のスクリーンショット（PayPay、WeChat Pay。複数枚や縦長のスクショも可）を選ぶと、AI が金額・日付・店名・カテゴリを入力します。確認してから保存してください。無料の Gemini API キーが必要です。',
      'ai.setupTitle': 'Gemini API キー', 'ai.keyLabel': 'API キー', 'ai.remove': 'キーを削除',
      'ai.step1': 'Google アカウントで下のページを開き、API キーを作成します。', 'ai.step2': 'キーをコピーして下に貼り付け、右上の「保存」をタップします。',
      'ai.privacy': 'キーはこの端末にだけ保存され、バックアップには含まれません。読み取りのとき、写真とカテゴリ名・口座名が Google に送信されます。無料枠では、Google が製品の改善に利用したり、人が確認したりする場合があります。支出・収入の支払い方法は AI では変わらず、自分で選びます。チャージなど振替の口座は AI が推測し、変更できます。',
      'ai.saved': '保存しました。レシート撮影が使えます', 'ai.savedUnchecked': '保存しました（オフラインのためキーは未確認）', 'ai.removed': 'キーを削除しました',
      'ai.badKey': 'このキーは使えません。もう一度コピーしてください', 'ai.enterKey': 'API キーを貼り付けてください', 'ai.checking': 'キーを確認しています…',
      'ai.done': '写真から入力しました。確認して保存してください', 'ai.noAmount': '金額を読み取れませんでした。撮り直すか手入力してください', 'ai.offline': 'オフラインです。接続してから試してください',
      'ai.quota': '無料枠の上限に達しました。しばらくしてから試してください', 'ai.failed': '読み取りに失敗しました：{m}', 'ai.timeout': '時間切れになりました。もう一度お試しください', 'ai.badImage': 'この画像は開けません',
      'ai.doneSkip': '写真から入力しました。確認して保存してください（スキップ：{s}）',
      'scan.found': '{n}件見つかりました', 'scan.add': '{n}件を追加', 'scan.added': '{n}件を追加しました', 'scan.undone': '元に戻しました',
      'scan.same': 'この日に同じ金額あり：{w}', 'scan.twin': '上の項目と日付・金額が同じ', 'scan.from': '振替元', 'scan.to': '振替先', 'scan.needMove': 'チェックした振替の振替元と振替先を選んでください',
      'scan.noDate': '日付が読み取れません。確認してください', 'scan.pickCat': 'カテゴリを選択', 'scan.needCat': 'チェックした項目にカテゴリを選んでください',
      'scan.skipped': 'スキップ：{s}', 'scan.none': '記録できる取引がありません（スキップ：{s}）', 'scan.sep': '、',
      'scan.hint': '支出・収入は上で選んだ支払い方法に、振替は項目ごとに選んだ口座に記録します。金額やメモは保存後に「明細」で変更できます。',
      'ai.tooMany': '一度に選べるのは{n}枚までです', 'ai.tooLong': '画像が多すぎるか長すぎます。何回かに分けてください',
      'dup.ask': '{d}に同じ金額の記録がすでにあります：{w}。もう1件記録しますか？', 'dup.go': '記録する',
      'scan.title': 'AI 読み取り', 'ss.prep': '画像の準備', 'ss.upload': 'アップロード', 'ss.ai': 'AI 読み取り',
      'ss.prepDone': '{n}枚', 'ss.prepSlices': '{n}枚・縦長を{p}分割', 'ss.prepSkip': '{n}枚は開けないため除外しました',
      'ss.upPct': '{p}%・{a} / {b}', 'ss.wait': '{m}・応答待ち {s}秒', 'ss.recv': '{n}件読み取り済み・{s}秒', 'ss.done': '完了・{s}秒',
      'ss.switch': '{a} が使えないため（{c}）、{b} に切り替えました', 'ss.slowSwitch': '{a} が{s}秒応答しないため、{b} に切り替えました', 'ss.noThink': 'このモデルは思考設定に未対応のため、送り直しました',
      'ss.waiting': '読み取れた取引がここに順に表示されます', 'ss.none': '記録できる取引がありません',
      'ss.stallUp': 'アップロードが進みません。通信状況を確認してください', 'ss.stallAi': 'AI から {s}秒応答がありません', 'ss.net': '通信が切れました',
      'ss.cut': '読み取れた分は追加できます。再試行もできます。', 'ss.retry': '再試行', 'ss.fill': '入力画面で編集',
      'scan.discard': '読み取り結果はまだ追加されていません。破棄しますか？', 'scan.discardBtn': '破棄',
      'aa.people': '{n}人', 'aa.mine': '自分 {v}', 'aa.title': 'AA・{n}人', 'aa.total': '合計 {v}・「{a}」で支払い', 'aa.others': 'ほかの{n}人から返ってくるお金',
      'aa.who': '友達 {i}', 'aa.accPh': '受取方法', 'aa.mineBox': '自分の分 {v} を「{c}」の支出として記録', 'aa.amtLabel': '金額',
      'aa.note': '友達からのお金は「{a}」から受取口座への振替として記録し、収入にも支出にも含めません（AA の印付き）。「{a}」自体に戻った分は記録しません。',
      'aa.needAcc': '全員の受取方法を選んでください', 'aa.needAmt': '全員の金額を入力してください', 'aa.tooMuch': '友達の合計が総額を超えています',
      'aa.saved': 'AA を記録しました：自分の分 {v}（合計 {t}・{n}人）', 'aa.over': '自分の分は ¥0。超えた {x} は受取口座の残高にだけ反映し、収入にも支出にも含めません', 'aa.extra': 'AA 超過分', 'aa.extraCsv': '（AA 超過分、収支に含めない）', 'aa.delExtra': 'この AA 超過分を削除しますか？', 'aa.sub': '{n}人・合計{t}', 'aa.delAsk': 'この AA を削除しますか？関連する {k} 件（友達からの返金）も削除されます。',
      'aa.descT': '（AA 合計{t}）', 'scan.aaSame': '記録済みの AA の返金かもしれません：{w}',
      'scan.sk.points': 'ポイント {n}件', 'scan.sk.failed': '失敗・取消 {n}件', 'scan.sk.foreign': '円の金額なし {n}件',
    },
    en: {
      'app.name': 'Kakeibo', 'nav.label': 'Main menu',
      'tab.home': 'Home', 'tab.list': 'Entries', 'tab.assets': 'Assets', 'tab.settings': 'Settings',
      'kind.out': 'Expense', 'kind.in': 'Income', 'kind.move': 'Transfer',
      'type.bank': 'Bank', 'type.cash': 'Cash', 'type.ewallet': 'E-wallet', 'type.credit': 'Credit card', 'type.securities': 'Securities', 'type.other': 'Other',
      'today': 'Today', 'yesterday': 'Yesterday', 'tomorrow': 'Tomorrow', 'future': 'Planned',
      'month.prev': 'Previous month', 'month.next': 'Next month',
      'common.save': 'Save', 'common.cancel': 'Cancel', 'common.ok': 'OK', 'common.delete': 'Delete', 'common.undo': 'Undo', 'common.close': 'Close',
      'common.add': '＋ Add', 'common.name': 'Name', 'common.saved': 'Saved', 'common.undone': 'Undone', 'common.enterName': 'Enter a name',
      'common.hide': 'Hide (not shown when picking)', 'common.hiddenTag': 'Hidden', 'common.up': 'Move up', 'common.down': 'Move down', 'common.movedUp': 'Moved up', 'common.movedDown': 'Moved down',
      'count': '{n} entries', 'count1': '1 entry', 'uncat': 'Uncategorized', 'other': 'Other', 'deleted': '(deleted)', 'deletedAcc': '(deleted account)',
      'owed': 'Owed', 'balance': 'Balance', 'prev.month': 'Last month {v}',
      'saveFail': 'Couldn’t save — storage may be full',
      'welcome.title': '👋 Welcome to Kakeibo',
      'welcome.text': 'Your data stays on this phone and works offline. First set up your accounts in Settings and enter their current balances, or import a backup if you have one.',
      'welcome.setup': 'Set up accounts', 'welcome.import': 'Import backup',
      'nudge.never': 'No backup yet', 'nudge.days': 'No backup for {n} days', 'nudge.btn': 'Back up',
      'home.spendThis': 'Spending this month', 'home.spendIn': 'Spending in {m}', 'home.net': 'Net',
      'comp.title': '{k} breakdown', 'comp.total': '{k} total', 'comp.empty': 'Nothing recorded this month yet',
      'trend.title': '{k} by month', 'trend.tap': 'Tap a bar for the amount', 'trend.avg': 'Monthly avg (dashed)', 'trend.aria': 'Monthly trend',
      'trend.wait': 'After two months of records, a monthly bar chart and average appear here.',
      'recent.title': 'Recent', 'recent.all': 'See all entries ›', 'recent.empty': 'Tap ＋ below to add your first entry',
      'list.all': 'All', 'list.category': 'Category', 'list.account': 'Account', 'list.empty': 'No matching entries in {m}',
      'card.usage': 'This month {a} · Last month {b}',
      'assets.asOf': 'As of {d}', 'assets.net': 'Net worth (after card balances)', 'assets.delta': 'vs last month-end {v}', 'assets.assets': 'Assets', 'assets.debt': 'Debt (card balances)',
      'assets.future': '{n} future-dated entries will count toward balances on their dates.', 'assets.future1': '1 future-dated entry will count toward balances on its date.',
      'assets.noAcc': 'No accounts yet. Add one in Settings',
      'assets.trend': 'Net worth by month', 'assets.monthEnd': 'Month-end', 'assets.trendWait': 'From next month, your month-end net worth will appear here.',
      'assets.comp': 'Asset mix', 'assets.noPositive': 'No accounts with a positive balance yet',
      'assets.accounts': 'Accounts', 'sort.btn': 'Reorder', 'sort.title': 'Reorder accounts', 'sort.done': 'Done', 'sort.saved': 'Order saved',
      'sort.hint': 'Hold ≡ on the right and drag up or down to reorder the groups, or the accounts inside a group. New entry, Settings and Assets all use this order.',
      'sort.dragGroup': 'Drag to reorder group', 'sort.dragItem': 'Drag to reorder',
      'set.accounts': 'Accounts', 'set.noAcc': 'No accounts yet',
      'set.cardHint': 'Card balances show as negative (money owed). When you pay a card, record a Transfer from your bank to the card.',
      'set.categories': 'Categories', 'set.noCat': 'No categories yet', 'set.addOut': '＋ Add expense category', 'set.addIn': '＋ Add income category',
      'set.prefs': 'Preferences', 'set.autoAdd': 'Open straight into “New entry”', 'set.autoOn': 'Will open straight into “New entry” next time', 'set.autoOff': 'Turned off',
      'set.backup': 'Backup', 'set.bNever': 'No backup yet', 'set.bLast': 'Last backup: ', 'set.bToday': 'today', 'set.bDays': '{n} days ago', 'set.bDays1': '1 day ago',
      'set.export': 'Export backup file', 'set.copy': 'Copy backup as text', 'set.importFile': 'Import from file (backup / CSV)', 'set.paste': 'Paste text to import', 'set.csv': 'Export entries as CSV',
      'set.backupHint': 'Data is stored only on this phone. Deleting the home-screen icon deletes the data too, so export a backup about once a month and keep it in Files or cloud storage.',
      'set.lang': 'Language', 'set.langDone': 'Switched to English',
      'about': 'Kakeibo · Version {v}', 'persist.yes': 'Storage: persistent', 'persist.no': 'Storage: standard',
      'entry.new': 'New entry', 'entry.edit': 'Edit', 'entry.from': 'From (money goes out)', 'entry.to': 'To (money comes in)',
      'entry.noCat': 'Add a category in Settings first', 'entry.noAcc': 'Add an account in Settings first', 'entry.received': 'Received in', 'entry.paid': 'Paid with',
      'entry.date': 'Date', 'entry.memo': 'Note (optional)', 'entry.saveCont': 'Save & next',
      'entry.needAmount': 'Enter an amount', 'entry.needCat': 'Choose a category', 'entry.needFrom': 'Choose the From account', 'entry.needAcc': 'Choose an account',
      'entry.needTo': 'Choose the To account', 'entry.same': 'From and To must be different accounts',
      'entry.savedCont': 'Saved {w}. Add the next one', 'entry.savedEdit': 'Changes saved', 'entry.saved': 'Saved {w}',
      'entry.delAsk': 'Delete this entry?', 'entry.deleted': 'Deleted', 'entry.restored': 'Restored',
      'acc.add': 'Add account', 'acc.edit': 'Edit account', 'acc.namePh': 'e.g. MUFG Bank', 'acc.type': 'Type',
      'acc.balNow': 'Balance now', 'acc.oweNow': 'Amount owed now',
      'acc.balHint': 'How much is actually in this account today (check your bank or wallet app).',
      'acc.oweHint': 'Check your card app for the amount owed now and enter it as a positive number. Card spending adds to it; record a Transfer when you pay.',
      'acc.adjSwitch': 'Record the difference as an adjustment', 'acc.adjSwitchSub': 'Turn off to change only the starting balance, without counting it as income or spending (good for first-time setup)',
      'acc.dupe': 'An account with this name already exists', 'acc.inUse': '{n} entries use this account, so it can’t be deleted. You can hide it instead.',
      'acc.inUse1': '1 entry uses this account, so it can’t be deleted. You can hide it instead.', 'acc.delAsk': 'Delete this account?',
      'adj.more': '{v} more than recorded', 'adj.less': '{v} less than recorded', 'adj.oweMore': 'Owed {v} more than recorded', 'adj.oweLess': 'Owed {v} less than recorded',
      'adj.book': '. Saving records it today as “{c}”', 'adj.initial': '. Saving changes only the starting balance, not counted as income or spending', 'adj.done': 'Recorded {c} {v} today',
      'cat.add': 'Add category', 'cat.edit': 'Edit category', 'cat.kind': 'Type', 'cat.locked': ' (has entries, can’t change)', 'cat.namePh': 'e.g. Coffee',
      'name.hint': 'Changes the {l} name only. Other languages keep their own names.', 'name.hintNew': 'Other languages show this name until you rename it there.',
      'cat.icon': 'Icon (pick below or type any emoji)',
      'cat.dupe': 'A category with this name already exists', 'cat.inUse': '{n} entries use this category, so it can’t be deleted. You can hide it instead.',
      'cat.inUse1': '1 entry uses this category, so it can’t be deleted. You can hide it instead.', 'cat.delAsk': 'Delete this category?',
      'bk.exported': 'Backup exported', 'bk.copied': 'Backup copied. Paste it into Notes or a chat to keep it.', 'bk.csvDone': 'CSV exported',
      'imp.noCols': 'Couldn’t find the 日期 and 金额 columns in the CSV', 'imp.empty': 'Nothing to import', 'imp.broken': 'The backup is incomplete and can’t be read', 'imp.notOurs': 'This isn’t a Kakeibo backup',
      'imp.replaceAsk': 'Replace all current data with this backup?\nIt has {e} entries, {a} accounts and {c} categories.', 'imp.replaceBtn': 'Replace',
      'imp.replaced': 'Imported {n} entries', 'imp.replaced1': 'Imported 1 entry',
      'imp.badCsv': 'Invalid CSV format', 'imp.noRows': 'No entries to import in the CSV', 'imp.newItems': '\n{c} categories and {a} accounts will be created.',
      'imp.appendAsk': 'Add {n} entries from the CSV?', 'imp.appendAsk1': 'Add 1 entry from the CSV?', 'imp.skip': '\n{n} unreadable rows will be skipped.', 'imp.skip1': '\n1 unreadable row will be skipped.',
      'imp.appendBtn': 'Add', 'imp.appended': 'Added {n} entries', 'imp.appended1': 'Added 1 entry', 'imp.readFail': 'Couldn’t read the file',
      'paste.export': 'Backup text', 'paste.import': 'Paste to import', 'paste.go': 'Import',
      'paste.exportLabel': 'Long-press, select all and copy, then keep it in Notes or a chat', 'paste.importLabel': 'Paste backup text or CSV here',
      'paste.hint': 'Backup text (starting with {) replaces all data; CSV (日期,内容,金额,收支,分类,支付方式,备注) is added to your existing entries.',
      'sw.ready': 'Update downloaded. It applies when you close this screen',
      'ai.scan': 'Scan receipt', 'ai.busy': 'Reading…', 'ai.title': 'Receipt scan (AI)', 'ai.setup': 'Set up key', 'ai.change': 'Change or remove key',
      'ai.on': 'Your Gemini key is set. Tap “📷 Scan receipt” on the New entry screen to fill it in from a photo.',
      'ai.off': 'Snap a receipt or pick screenshots of your payment history (PayPay, WeChat Pay; several at once or long screenshots work too) and AI fills in the amount, date, shop and category for you to check. Needs a free Gemini API key.',
      'ai.setupTitle': 'Gemini API key', 'ai.keyLabel': 'API key', 'ai.remove': 'Remove key',
      'ai.step1': 'Open the page below with your Google account and create an API key.', 'ai.step2': 'Copy the key, paste it below and tap Save.',
      'ai.privacy': 'The key stays on this phone and is never put in backups. Photos, along with your category and account names, are sent to Google to be read; on the free tier Google may use them to improve its products, and people may review them. AI never changes the payment method for spending or income; you choose it. For transfers such as top-ups, AI suggests the accounts and you can change them.',
      'ai.saved': 'Saved. Receipt scan is ready', 'ai.savedUnchecked': 'Saved (offline, so the key wasn’t checked)', 'ai.removed': 'Key removed',
      'ai.badKey': 'That key doesn’t work. Copy it again', 'ai.enterKey': 'Paste an API key', 'ai.checking': 'Checking the key…',
      'ai.done': 'Filled in from the photo. Check it, then save', 'ai.noAmount': 'Couldn’t find an amount. Retake or type it in', 'ai.offline': 'You’re offline. Try again when connected',
      'ai.quota': 'Free quota used up for now. Try again later', 'ai.failed': 'Couldn’t read the photo: {m}', 'ai.timeout': 'Timed out. Please try again', 'ai.badImage': 'Couldn’t open this image',
      'ai.doneSkip': 'Filled in from the photo. Check it, then save (skipped: {s})',
      'scan.found': 'Found {n} transactions', 'scan.found1': 'Found 1 transaction', 'scan.add': 'Add {n} entries', 'scan.add1': 'Add 1 entry',
      'scan.added': 'Added {n} entries', 'scan.added1': 'Added 1 entry', 'scan.undone': 'Undone',
      'scan.same': 'Same amount already on this day: {w}', 'scan.twin': 'Same date and amount as one above', 'scan.from': 'From', 'scan.to': 'To', 'scan.needMove': 'Choose both accounts for every checked transfer',
      'scan.noDate': 'No date found, please check', 'scan.pickCat': 'Choose a category', 'scan.needCat': 'Choose a category for every checked item',
      'scan.skipped': 'Skipped: {s}', 'scan.none': 'Nothing to record (skipped: {s})', 'scan.sep': ', ',
      'scan.hint': 'Spending and income go to the payment method above; transfers use the accounts chosen on each. Amounts and notes can be changed later under Entries.',
      'ai.tooMany': 'Up to {n} images at a time', 'ai.tooLong': 'Too many or too long images. Please split them up',
      'dup.ask': 'There is already an entry with the same amount on {d}: {w}. Add this one too?', 'dup.go': 'Add anyway',
      'scan.title': 'AI scan', 'ss.prep': 'Preparing images', 'ss.upload': 'Uploading', 'ss.ai': 'AI reading',
      'ss.prepDone': '{n} images', 'ss.prepDone1': '1 image', 'ss.prepSlices': '{n} images · long ones cut into {p} parts', 'ss.prepSlices1': '1 image · cut into {p} parts', 'ss.prepSkip': '{n} could not be opened and were left out', 'ss.prepSkip1': '1 could not be opened and was left out',
      'ss.upPct': '{p}% · {a} / {b}', 'ss.wait': '{m} · waiting {s}s', 'ss.recv': '{n} found · {s}s', 'ss.done': 'Done · {s}s',
      'ss.switch': '{a} unavailable ({c}), switched to {b}', 'ss.slowSwitch': '{a} gave no reply for {s}s, switched to {b}', 'ss.noThink': 'This model does not take the thinking setting; sent again',
      'ss.waiting': 'Transactions appear here as they are found', 'ss.none': 'Nothing to record',
      'ss.stallUp': 'The upload is stuck. Check your connection', 'ss.stallAi': 'No reply from AI for {s}s', 'ss.net': 'The connection dropped',
      'ss.cut': 'You can add what was found, or try again.', 'ss.retry': 'Try again', 'ss.fill': 'Edit in New entry',
      'scan.discard': 'These results have not been added. Discard them?', 'scan.discardBtn': 'Discard',
      'aa.people': '{n} people', 'aa.mine': 'Mine {v}', 'aa.title': 'AA · {n} people', 'aa.total': 'Total {v} · paid with {a}', 'aa.others': 'What the other {n} pay you back', 'aa.others1': 'What the other person pays you back',
      'aa.who': 'Friend {i}', 'aa.accPh': 'Paid back to', 'aa.mineBox': 'Your share {v}, recorded as {c} spending', 'aa.amtLabel': 'Amount',
      'aa.note': 'Money paid back is recorded as a transfer from {a} to the account it went to, not as income or spending, and marked AA. Money paid back into {a} itself needs no transfer.',
      'aa.needAcc': 'Choose where each person paid you back', 'aa.needAmt': 'Enter an amount for each person', 'aa.tooMuch': 'Friends’ total is more than the bill',
      'aa.saved': 'AA saved: your share {v} (total {t}, {n} people)', 'aa.over': 'Your share is ¥0. The extra {x} only goes into the receiving account balance, not income or spending', 'aa.extra': 'AA extra', 'aa.extraCsv': ' (AA extra, not income or spending)', 'aa.delExtra': 'Delete this AA extra?', 'aa.sub': '{n} people · total {t}', 'aa.delAsk': 'Delete this AA? Its {k} related pay-back records will be deleted too.', 'aa.delAsk1': 'Delete this AA? Its related pay-back record will be deleted too.',
      'aa.descT': ' (AA, total {t})', 'scan.aaSame': 'May be an AA pay-back already recorded: {w}',
      'scan.sk.points': '{n} points items', 'scan.sk.points1': '1 points item',
      'scan.sk.failed': '{n} failed or cancelled', 'scan.sk.failed1': '1 failed or cancelled', 'scan.sk.foreign': '{n} without a yen amount', 'scan.sk.foreign1': '1 without a yen amount',
    },
  };
  const HTML_LANG = { zh: 'zh-CN', ja: 'ja', en: 'en' };
  const LANG_NAME = { zh: '中文', ja: '日本語', en: 'English' };
  let LANG = (() => {
    try {
      const v = (JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}).lang;
      if (I18N[v]) return v;
      /* first launch on this phone: follow the phone's language */
      if (!localStorage.getItem(STORE_KEY)) {
        for (const l of navigator.languages || [navigator.language]) {
          const s = String(l || '').toLowerCase();
          if (s.startsWith('ja')) return 'ja';
          if (s.startsWith('zh')) return 'zh';
          if (s.startsWith('en')) return 'en';
        }
        return 'en';
      }
    } catch (e) { /* storage unavailable */ }
    return 'zh';
  })();
  function tr(key, p) {
    const dict = I18N[LANG] || I18N.zh;
    const k = p && p.n === 1 && dict[key + '1'] !== undefined ? key + '1' : key;
    let s = dict[k] !== undefined ? dict[k] : I18N.zh[key] !== undefined ? I18N.zh[key] : key;
    if (p) s = s.replace(/\{(\w+)\}/g, (m, name) => (p[name] !== undefined ? String(p[name]) : m));
    return s;
  }

  const mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const isDark = () => !!(mqDark && mqDark.matches);
  /* categorical slots 1–5 of the validated palette (light / dark steps) */
  const SERIES_L = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
  const SERIES_D = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];
  const series = () => (isDark() ? SERIES_D : SERIES_L);
  const otherGray = () => (isDark() ? '#5f5e58' : '#b4b2a9');

  /* card colours: dark steps (white text >= 4.5:1); chart: the same hue family from the validated slots */
  const ACC_TYPES = {
    bank: { color: '#b45700', icon: '🏦', slot: 1 },
    cash: { color: '#8a6100', icon: '💴', slot: 3 },
    ewallet: { color: '#0d7a6e', icon: '📱', slot: 2 },
    credit: { color: '#1c7a41', icon: '💳', slot: null },
    securities: { color: '#2a66bd', icon: '📈', slot: 0 },
    other: { color: '#a8336b', icon: '🗂️', slot: 4 },
  };
  /* stacked-bar order follows the palette's validated adjacency (slot 1→5) */
  const COMP_ORDER = ['securities', 'bank', 'ewallet', 'cash', 'other'];
  const ACC_ORDER = ['bank', 'cash', 'ewallet', 'credit', 'securities', 'other'];
  /* the user's group (account type) order: known types once each, missing ones appended */
  const normTypeOrder = (o) => {
    const seen = (Array.isArray(o) ? o : []).filter((t, i, arr) => ACC_TYPES[t] && arr.indexOf(t) === i);
    return [...seen, ...ACC_ORDER.filter((t) => !seen.includes(t))];
  };
  const typeName = (t) => tr('type.' + t);
  const kindName = (k) => tr('kind.' + k);
  /* CSV keeps the Google Sheet's column values whatever the UI language */
  const CSV_KIND = { out: '支出', in: '收入', move: '转移' };
  const EMOJIS = ['🍚', '🍜', '🍱', '☕', '🍺', '🍰', '🛒', '🧻', '🧴', '🎮', '🎬', '🎵', '📚', '✏️', '🚃', '🚕', '⛽', '✈️', '🏠', '🏦', '💡', '💧', '🔥', '📱', '💻', '👕', '💄', '💇', '💊', '🏥', '🏋️', '🎁', '🐶', '👶', '🧾', '☂️', '📦', '💴', '💰', '🎉', '📈', '🪙'];

  /* Built-in categories and accounts have a name in every UI language. Items the user adds are
     named in the language active at the time (lang0); other languages show that name until the
     item is renamed while that language is active. A rename only changes the current language. */
  const BASE_CATS = {
    food: { kind: 'out', icon: '🍚', zh: '餐饮', ja: '食費', en: 'Food' },
    coffee: { kind: 'out', icon: '☕', zh: '咖啡', ja: 'カフェ', en: 'Coffee', after: 'food' },
    conbini: { kind: 'out', icon: '🏪', zh: '便利店', ja: 'コンビニ', en: 'Convenience store', after: ['coffee', 'food'] },
    daily: { kind: 'out', icon: '🧻', zh: '日用品', ja: '日用品', en: 'Household' },
    hobby: { kind: 'out', icon: '🎮', zh: '兴趣娱乐', ja: '趣味・娯楽', en: 'Hobbies' },
    social: { kind: 'out', icon: '🍻', zh: '交际', ja: '交際費', en: 'Social' },
    transport: { kind: 'out', icon: '🚃', zh: '交通', ja: '交通費', en: 'Transport' },
    clothes: { kind: 'out', icon: '👕', zh: '服装美容', ja: '衣服・美容', en: 'Clothes & beauty' },
    health: { kind: 'out', icon: '💊', zh: '健康医疗', ja: '健康・医療', en: 'Health' },
    study: { kind: 'out', icon: '📚', zh: '学习教育', ja: '教養・教育', en: 'Education' },
    utilities: { kind: 'out', icon: '💡', zh: '水电燃气', ja: '水道・光熱費', en: 'Utilities' },
    phone: { kind: 'out', icon: '📱', zh: '通信', ja: '通信費', en: 'Phone & internet' },
    housing: { kind: 'out', icon: '🏠', zh: '住房', ja: '住宅', en: 'Housing' },
    tax: { kind: 'out', icon: '🧾', zh: '税金社保', ja: '税・社会保障', en: 'Taxes' },
    insurance: { kind: 'out', icon: '☂️', zh: '保险', ja: '保険', en: 'Insurance' },
    special: { kind: 'out', icon: '🎁', zh: '特别支出', ja: '特別な支出', en: 'Special spending' },
    otherOut: { kind: 'out', icon: '📦', zh: '其他支出', ja: 'その他の支出', en: 'Other spending' },
    salary: { kind: 'in', icon: '💴', zh: '工资', ja: '給与', en: 'Salary' },
    bonus: { kind: 'in', icon: '🎉', zh: '奖金', ja: '賞与', en: 'Bonus' },
    side: { kind: 'in', icon: '💻', zh: '副业', ja: '副業', en: 'Side income' },
    invest: { kind: 'in', icon: '📈', zh: '投资收益', ja: '投資収益', en: 'Investment' },
    otherIn: { kind: 'in', icon: '💰', zh: '其他收入', ja: 'その他の収入', en: 'Other income' },
    /* not created up front; recognised so that existing items get their other-language names */
    mortgage: { kind: 'out', icon: '🏦', zh: '房贷', ja: '住宅ローン', en: 'Mortgage', extra: true },
    adjIn: { kind: 'in', icon: '⚖️', zh: '特殊收入', ja: '特殊収入', en: 'Adjustment +', extra: true },
    adjOut: { kind: 'out', icon: '⚖️', zh: '特殊支出', ja: '特殊支出', en: 'Adjustment −', extra: true },
  };
  /* built-ins introduced after the first release: added once to existing data, right after `after` */
  const LATER_CATS = ['coffee', 'conbini'];
  let laterAdded = false;
  const BASE_ACCS = {
    cash: { type: 'cash', zh: '现金', ja: '現金', en: 'Cash' },
    bank: { type: 'bank', zh: '银行账户', ja: '銀行口座', en: 'Bank account' },
    card: { type: 'credit', zh: '信用卡', ja: 'クレジットカード', en: 'Credit card' },
    wallet: { type: 'ewallet', zh: '电子钱包', ja: '電子マネー', en: 'E-wallet' },
  };
  const BASES = { cat: BASE_CATS, acc: BASE_ACCS };
  const LANGS = ['zh', 'ja', 'en'];
  /* name in a language: the user's own name for it, else the built-in one, else the name it was created with */
  const labelIn = (x, what, lang) => (x.names && x.names[lang]) || (x.base && BASES[what][x.base] && BASES[what][x.base][lang]) || x.name;
  const cName = (c) => (c ? labelIn(c, 'cat', LANG) : tr('uncat'));
  const aName = (a) => (a ? labelIn(a, 'acc', LANG) : tr('deletedAcc'));
  /* every name an item goes by, for matching imported rows */
  const allLabels = (x, what) => [x.name, ...Object.values(x.names || {}), ...(x.base && BASES[what][x.base] ? LANGS.map((l) => BASES[what][x.base][l]) : [])];
  function setLabel(x, what, value) {
    const b = x.base && BASES[what][x.base];
    const own = LANG === (x.lang0 || 'zh');
    const names = Object.assign({}, x.names);
    if (b ? b[LANG] === value : own || value === x.name) {
      delete names[LANG];
      if (!b && own) x.name = value;
    } else names[LANG] = value;
    if (Object.keys(names).length) x.names = names; else delete x.names;
  }
  /* the built-in item an older entry corresponds to, by any of its names */
  const findBase = (what, name, kindOrType) => Object.keys(BASES[what]).find((k) => {
    const b = BASES[what][k];
    return (what === 'cat' ? b.kind : b.type) === kindOrType && LANGS.some((l) => b[l] === name);
  }) || null;
  const cleanNames = (n, max) => {
    const o = {};
    if (n && typeof n === 'object') for (const l of LANGS) if (typeof n[l] === 'string' && n[l].trim()) o[l] = n[l].trim().slice(0, max);
    return Object.keys(o).length ? { names: o } : {};
  };

  /* ================= data ================= */
  function defaultData() {
    return {
      app: 'kakeibo', version: 1,
      categories: Object.keys(BASE_CATS).filter((k) => !BASE_CATS[k].extra)
        .map((k) => ({ id: uid(), name: BASE_CATS[k][LANG], base: k, lang0: LANG, kind: BASE_CATS[k].kind, icon: BASE_CATS[k].icon, hidden: false })),
      accounts: Object.keys(BASE_ACCS)
        .map((k) => ({ id: uid(), name: BASE_ACCS[k][LANG], base: k, lang0: LANG, type: BASE_ACCS[k].type, initial: 0, hidden: false })),
      typeOrder: [...ACC_ORDER],
      entries: [],
      meta: { createdAt: new Date().toISOString(), lastBackup: null, baseAdded: [...LATER_CATS] },
    };
  }
  const validData = (d) => !!(d && typeof d === 'object' && Array.isArray(d.categories) && Array.isArray(d.accounts) && Array.isArray(d.entries));
  function normalize(d) {
    const out = { app: 'kakeibo', version: 1 };
    out.meta = Object.assign({ createdAt: new Date().toISOString(), lastBackup: null }, d.meta || {});
    /* an id that isn't plain (say, from a crafted backup file) gets a fresh one, and entries follow the change */
    const remap = new Map();
    const cleanId = (v) => { const s = v == null ? '' : String(v); if (SAFE_ID.test(s)) return s; const n = uid(); if (s) remap.set(s, n); return n; };
    const ref = (v) => { if (v == null || v === '') return null; const s = String(v); return remap.has(s) ? remap.get(s) : SAFE_ID.test(s) ? s : null; };
    /* AA mark: g = group; on your share also n people, t total bill, p = what each friend paid back and where */
    const cleanAA = (v) => {
      if (!v || typeof v !== 'object' || !SAFE_ID.test(String(v.g || ''))) return {};
      const aa = { g: String(v.g) }, n = Math.round(Number(v.n)), t = Math.round(Number(v.t));
      if (n >= 2 && n <= 50 && t > 0) {
        aa.n = n; aa.t = t;
        aa.p = (Array.isArray(v.p) ? v.p : []).slice(0, n - 1).map((x) => ({ a: ref(x && x.a), v: Math.round(Number(x && x.v)) || 0 })).filter((x) => x.v > 0);
      }
      return { aa };
    };
    out.categories = d.categories.filter((c) => c && c.name).map((c) => {
      const kind = c.kind === 'in' ? 'in' : 'out', name = String(c.name).slice(0, 20);
      const sys = c.sys === 'adj-in' || c.sys === 'adj-out' ? c.sys : null;
      const base = BASE_CATS[c.base] && BASE_CATS[c.base].kind === kind ? c.base : sys ? (sys === 'adj-in' ? 'adjIn' : 'adjOut') : findBase('cat', name, kind);
      return {
        id: cleanId(c.id), name, kind, icon: String(c.icon || (kind === 'in' ? '💰' : '📦')).slice(0, 8), hidden: !!c.hidden,
        lang0: LANGS.includes(c.lang0) ? c.lang0 : 'zh', ...(base ? { base } : {}), ...(sys ? { sys } : {}), ...cleanNames(c.names, 20),
      };
    });
    /* add each later built-in once; one the user deletes afterwards stays deleted */
    const added = new Set(Array.isArray(out.meta.baseAdded) ? out.meta.baseAdded : []);
    for (const k of LATER_CATS) {
      if (added.has(k)) continue;
      added.add(k);
      laterAdded = true;
      if (out.categories.some((c) => c.base === k)) continue;
      const b = BASE_CATS[k];
      let at = -1;
      for (const a of [].concat(b.after || [])) { at = out.categories.findIndex((c) => c.base === a); if (at >= 0) break; }
      out.categories.splice(at >= 0 ? at + 1 : out.categories.length, 0,
        { id: uid(), name: b[LANG], kind: b.kind, icon: b.icon, hidden: false, lang0: LANG, base: k });
    }
    out.meta.baseAdded = [...added];
    out.accounts = d.accounts.filter((a) => a && a.name).map((a) => {
      const type = ACC_TYPES[a.type] ? a.type : 'other', name = String(a.name).slice(0, 24);
      const base = BASE_ACCS[a.base] && BASE_ACCS[a.base].type === type ? a.base : findBase('acc', name, type);
      return {
        id: cleanId(a.id), name, type, initial: Math.round(Number(a.initial) || 0), hidden: !!a.hidden,
        lang0: LANGS.includes(a.lang0) ? a.lang0 : 'zh', ...(base ? { base } : {}), ...cleanNames(a.names, 24),
      };
    });
    /* data from before group ordering existed: keep the order the accounts were already listed in */
    out.typeOrder = normTypeOrder(Array.isArray(d.typeOrder) ? d.typeOrder : out.accounts.map((a) => a.type));
    out.entries = d.entries
      .filter((e) => e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && ['out', 'in', 'move', 'adj'].includes(e.kind)
        /* an AA expense can be ¥0 when friends paid back the whole bill */
        && (Number(e.amount) > 0 || (e.kind === 'out' && Number(e.amount) === 0 && e.aa && Number(e.aa.t) > 0)))
      .map((e) => ({
        id: cleanId(e.id), date: e.date, amount: Math.round(Number(e.amount)), kind: e.kind,
        cat: e.kind === 'move' || e.kind === 'adj' ? null : ref(e.cat), acc: ref(e.acc),
        to: e.kind === 'move' ? ref(e.to) : null, memo: String(e.memo || '').slice(0, 60), ts: Number(e.ts) || 0,
        ...cleanAA(e.aa),
      }));
    return out;
  }
  function loadData() {
    for (const key of [STORE_KEY, PREV_KEY]) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) { const d = JSON.parse(raw); if (validData(d)) return normalize(d); }
      } catch (e) { /* try next */ }
    }
    return null;
  }
  let persistAsked = false;
  function requestPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ignore */ }
  }
  function saveData() {
    try {
      const cur = localStorage.getItem(STORE_KEY);
      if (cur) localStorage.setItem(PREV_KEY, cur);
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      requestPersist();
      return true;
    } catch (e) {
      toast(tr('saveFail'));
      return false;
    }
  }

  let data = loadData();
  if (!data) { data = defaultData(); saveData(); } else if (laterAdded) saveData();
  let catIdx = new Map(), accIdx = new Map();
  function reindex() {
    catIdx = new Map(data.categories.map((c) => [c.id, c]));
    accIdx = new Map(data.accounts.map((a) => [a.id, a]));
  }
  reindex();

  /* ================= ui state ================= */
  function loadUI() { try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; } }
  const savedUI = loadUI();
  const ui = {
    tab: 'home',
    month: curMonth(),
    compKind: savedUI.compKind === 'in' ? 'in' : 'out',
    trendCat: savedUI.trendCat || null,
    trendTip: null,
    lastAccAny: savedUI.lastAccAny || null,
    /* AA: last people count, and where friends last paid back */
    aaN: Number(savedUI.aaN) || 2,
    aaAcc: savedUI.aaAcc || null,
    autoAdd: savedUI.autoAdd !== false,
    filter: { kind: 'all', cat: null, acc: null },
    setKind: 'out',
  };
  function saveUI() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        compKind: ui.compKind, trendCat: ui.trendCat, lastAccAny: ui.lastAccAny, autoAdd: ui.autoAdd, lang: LANG, aaN: ui.aaN, aaAcc: ui.aaAcc,
      }));
    } catch (e) { /* ignore */ }
  }
  if (savedUI.lang !== LANG) saveUI();

  /* ================= aggregates ================= */
  const inMonth = (ym) => data.entries.filter((e) => e.date.slice(0, 7) === ym);
  const sumKind = (list, kind) => list.reduce((s, e) => s + (e.kind === kind ? e.amount : 0), 0);
  function startMonth() {
    let m = null;
    for (const e of data.entries) if (!m || e.date < m) m = e.date;
    return m ? m.slice(0, 7) : curMonth();
  }
  function catTotals(list, kind) {
    const m = new Map();
    /* a ¥0 AA share is not a category the month spent money on */
    for (const e of list) if (e.kind === kind && e.amount > 0) { const k = e.cat && catIdx.has(e.cat) ? e.cat : '_none'; m.set(k, (m.get(k) || 0) + e.amount); }
    return m;
  }
  const catOrder = (id) => { const i = data.categories.findIndex((c) => c.id === id); return i < 0 ? 999 : i; };
  /* colour follows the category: the 5 largest categories over all time own slots 1–5, the rest are "其他" */
  function colorSlots(kind) {
    const ranked = [...catTotals(data.entries, kind).entries()]
      .filter(([id]) => id !== '_none')
      .sort((a, b) => b[1] - a[1] || catOrder(a[0]) - catOrder(b[0]))
      .map(([id]) => id);
    const map = new Map();
    ranked.slice(0, 5).forEach((id, i) => map.set(id, i));
    return map;
  }
  function balances(through) {
    const b = new Map(data.accounts.map((a) => [a.id, a.initial]));
    for (const e of data.entries) {
      if (e.date > through) continue;
      if (e.kind === 'out') { if (b.has(e.acc)) b.set(e.acc, b.get(e.acc) - e.amount); }
      else if (e.kind === 'in' || e.kind === 'adj') { if (b.has(e.acc)) b.set(e.acc, b.get(e.acc) + e.amount); }
      else {
        if (b.has(e.acc)) b.set(e.acc, b.get(e.acc) - e.amount);
        if (b.has(e.to)) b.set(e.to, b.get(e.to) + e.amount);
      }
    }
    return b;
  }
  const netOf = (b) => sum([...b.values()]);
  const cardUsage = (accId, ym) => data.entries.reduce((s, e) => s + (e.kind === 'out' && e.acc === accId && e.date.slice(0, 7) === ym ? e.amount : 0), 0);
  const cmpDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.ts || 0) - (a.ts || 0));
  const usedAcc = (id) => data.entries.filter((e) => e.acc === id || e.to === id).length;
  const usedCat = (id) => data.entries.filter((e) => e.cat === id).length;
  /* accounts in the user's order: group (account type) order first, then their order inside the group */
  function orderedAccs(list = data.accounts) {
    const pos = new Map(data.accounts.map((a, i) => [a.id, i]));
    const t = data.typeOrder;
    return [...list].sort((a, b) => t.indexOf(a.type) - t.indexOf(b.type) || pos.get(a.id) - pos.get(b.id));
  }
  const activeAccs = (keep) => orderedAccs(data.accounts.filter((a) => !a.hidden || a.id === keep));
  const firstAcc = () => { const a = orderedAccs().find((x) => !x.hidden); return a ? a.id : null; };

  /* ================= small components ================= */
  const header = (title, right = '') => `<header class="top"><h1>${title}</h1>${right}</header>`;
  const monthSwitcher = () => `<div class="month-sw"><button data-act="month" data-v="-1" aria-label="${tr('month.prev')}">‹</button><button class="ms-label" data-act="month" data-v="0">${ymLabel(ui.month)}</button><button data-act="month" data-v="1" aria-label="${tr('month.next')}">›</button></div>`;
  const segmented = (name, opts, val, cls = '') => `<div class="seg ${cls}" role="tablist">${opts.map(([v, l]) => `<button class="${v === val ? 'on' : ''}" data-act="seg" data-seg="${name}" data-v="${v}" role="tab" aria-selected="${v === val}">${l}</button>`).join('')}</div>`;
  const chartW = () => Math.max(260, Math.min(528, $('#view').clientWidth || 360) - 64);

  function entryRow(e) {
    const c = e.cat ? catIdx.get(e.cat) : null;
    const a = accIdx.get(e.acc), t = accIdx.get(e.to);
    const future = e.date > todayStr();
    const fb = future ? `<span class="badge-future">${tr('future')}</span>` : '';
    const aaB = e.aa ? '<span class="badge-aa">AA</span>' : '';
    if (e.kind === 'adj') {
      return `<button class="row ${future ? 'future' : ''}" data-act="edit" data-id="${esc(e.id)}"><span class="ic mv">＋</span><span class="mid"><span class="title">${esc(e.memo || tr('aa.extra'))}${aaB}${fb}</span><span class="rsub">${esc(`${tr('aa.extra')} · ${a ? aName(a) : tr('deleted')}`)}</span></span><span class="amt mv">+${yen(e.amount)}</span></button>`;
    }
    if (e.kind === 'move') {
      return `<button class="row ${future ? 'future' : ''}" data-act="edit" data-id="${esc(e.id)}"><span class="ic mv">⇄</span><span class="mid"><span class="title">${esc(e.memo || kindName('move'))}${aaB}${fb}</span><span class="rsub">${esc(a ? aName(a) : tr('deleted'))} → ${esc(t ? aName(t) : tr('deleted'))}</span></span><span class="amt mv">${yen(e.amount)}</span></button>`;
    }
    const title = e.memo || cName(c);
    const subParts = [];
    if (e.memo) subParts.push(cName(c));
    subParts.push(aName(a));
    if (e.aa && e.aa.t) subParts.push(tr('aa.sub', { n: e.aa.n, t: yen(e.aa.t) }));
    return `<button class="row ${future ? 'future' : ''}" data-act="edit" data-id="${esc(e.id)}"><span class="ic">${esc(c ? c.icon : '❔')}</span><span class="mid"><span class="title">${esc(title)}${aaB}${fb}</span><span class="rsub">${esc(subParts.join(' · '))}</span></span><span class="amt ${e.kind === 'in' ? 'in' : ''}">${e.kind === 'in' ? '+' : '−'}${yen(e.amount)}</span></button>`;
  }

  /* ================= charts (plain SVG) ================= */
  function arcPath(cx, cy, R, r, a0, a1) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
    return `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
  }
  function donutSVG(segs, total, kind) {
    const S = 188, R = 86, r = 58, cx = S / 2, cy = S / 2;
    let parts = '';
    if (segs.length === 1) {
      parts = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${segs[0].color}" stroke-width="${R - r}"/>`;
    } else {
      let a0 = -Math.PI / 2;
      for (const s of segs) {
        const a1 = a0 + (s.v / total) * Math.PI * 2;
        parts += `<path class="seg-arc" d="${arcPath(cx, cy, R, r, a0, a1)}" fill="${s.color}"><title>${esc(s.name)} ${yen(s.v)}</title></path>`;
        a0 = a1;
      }
    }
    return `<svg class="donut" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="${tr('comp.title', { k: kindName(kind) })}">${parts}<text x="${cx}" y="${cy - 6}" class="d-cap" text-anchor="middle">${tr('comp.total', { k: kindName(kind) })}</text><text x="${cx}" y="${cy + 19}" class="d-val" text-anchor="middle">${yen(total)}</text></svg>`;
  }
  function roundTopBar(x, y, w, h) {
    if (h <= 0) return '';
    const rr = Math.min(4, w / 2, h);
    const b = y + h;
    return `M${x.toFixed(1)},${b.toFixed(1)}V${(y + rr).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + rr).toFixed(1)},${y.toFixed(1)}H${(x + w - rr).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + rr).toFixed(1)}V${b.toFixed(1)}Z`;
  }
  function barsSVG(months, vals, avg, tipMonth) {
    const W = chartW(), H = 176, padL = 34, padR = 6, padT = 22, padB = 24;
    const n = months.length, slots = Math.max(n, 6);
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const band = plotW / slots, bw = Math.min(22, band * 0.62);
    const maxV = niceMax(Math.max(...vals, avg, 1));
    const y = (v) => padT + plotH - (v / maxV) * plotH;
    let g = '';
    for (const t of [0, maxV / 2, maxV]) {
      g += `<line class="${t === 0 ? 'base' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
      g += `<text class="axis-t" x="${padL - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t === 0 ? '0' : compact(t)}</text>`;
    }
    const tip = tipMonth && months.includes(tipMonth) ? tipMonth : months[n - 1];
    months.forEach((m, i) => {
      const slot = slots - n + i;
      const cx = padL + band * slot + band / 2;
      const x = cx - bw / 2;
      const v = vals[i];
      const isCur = i === n - 1;
      g += `<g data-act="bar" data-v="${m}"><rect class="hit" x="${(padL + band * slot).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}"/>`;
      if (v > 0) g += `<path class="${isCur ? 'bar-cur' : 'bar-past'}" d="${roundTopBar(x, y(v), bw, y(0) - y(v))}"/>`;
      g += `<text class="axis-m ${isCur ? 'cur' : ''}" x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle">${monShort(m)}</text></g>`;
      if (m === tip) g += `<text class="val-t" x="${cx.toFixed(1)}" y="${(y(v) - 6).toFixed(1)}" text-anchor="middle">${compact(v)}</text>`;
    });
    if (avg > 0) {
      g += `<line class="avg" x1="${padL}" x2="${W - padR}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"/>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${tr('trend.aria')}">${g}</svg>`;
  }
  function lineSVG(months, vals) {
    const W = chartW(), H = 160, padL = 40, padR = 14, padT = 22, padB = 24;
    const n = months.length;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const minV = Math.min(0, ...vals), maxV = niceMax(Math.max(...vals, 1));
    const lo = minV < 0 ? -niceMax(-minV) : 0;
    const y = (v) => padT + plotH - ((v - lo) / (maxV - lo)) * plotH;
    const x = (i) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    let g = '';
    const ticks = lo < 0 ? [lo, 0, maxV] : [0, maxV / 2, maxV];
    for (const t of ticks) {
      g += `<line class="${t === 0 ? 'base' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`;
      g += `<text class="axis-t" x="${padL - 6}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t === 0 ? '0' : compact(t)}</text>`;
    }
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    g += `<path class="area" d="M${x(0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}L${pts.join('L')}L${x(n - 1).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)}Z"/>`;
    g += `<path class="line" d="M${pts.join('L')}"/>`;
    const step = n > 6 ? Math.ceil(n / 6) : 1;
    months.forEach((m, i) => {
      if (i % step === 0 || i === n - 1) g += `<text class="axis-m ${i === n - 1 ? 'cur' : ''}" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${monShort(m)}</text>`;
    });
    const last = vals[n - 1];
    g += `<circle class="pt" cx="${x(n - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="4.5"/>`;
    g += `<text class="val-t" x="${Math.min(x(n - 1), W - padR - 18).toFixed(1)}" y="${(y(last) - 10).toFixed(1)}" text-anchor="middle">${compact(last)}</text>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${tr('assets.trend')}">${g}</svg>`;
  }

  /* ================= views ================= */
  const view = $('#view');
  function render() {
    $$('.tabbar [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const html = ui.tab === 'home' ? renderHome() : ui.tab === 'list' ? renderList() : ui.tab === 'assets' ? renderAssets() : renderSettings();
    view.innerHTML = html;
    if (ui.tab === 'settings') updatePersistState();
  }

  function backupDays() {
    const lb = data.meta.lastBackup;
    if (!lb) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(lb).getTime()) / 86400000));
  }
  function topNotices() {
    if (!data.entries.length) {
      return `<section class="card welcome"><h2>${tr('welcome.title')}</h2><p>${tr('welcome.text')}</p><div class="btn-pair"><button class="btn ghost" data-act="go-settings">${tr('welcome.setup')}</button><button class="btn primary" data-act="paste-import">${tr('welcome.import')}</button></div></section>`;
    }
    const days = backupDays();
    if (data.entries.length >= 10 && (days === null || days >= 30)) {
      return `<section class="card nudge"><span class="nt">💾 ${days === null ? tr('nudge.never') : tr('nudge.days', { n: days })}</span><button class="btn primary sm" data-act="export">${tr('nudge.btn')}</button></section>`;
    }
    return '';
  }

  function renderHome() {
    const ym = ui.month, prev = addMonths(ym, -1);
    const list = inMonth(ym), plist = inMonth(prev);
    const out = sumKind(list, 'out'), inc = sumKind(list, 'in');
    const pout = sumKind(plist, 'out'), pin = sumKind(plist, 'in');
    const net = inc - out, pnet = pin - pout;
    const label = ym === curMonth() ? tr('home.spendThis') : tr('home.spendIn', { m: ymLabel(ym) });
    return `${header(tr('tab.home'), monthSwitcher())}
      ${topNotices()}
      <section class="card">
        <div class="sum-label">${label}</div>
        <div class="hero">${yen(out)}</div>
        <div class="sub">${tr('prev.month', { v: yen(pout) })}</div>
        <div class="tiles">
          <div class="tile"><div class="t-label">${kindName('in')}</div><div class="t-val">${yen(inc)}</div><div class="t-sub">${tr('prev.month', { v: yen(pin) })}</div></div>
          <div class="tile"><div class="t-label">${tr('home.net')}</div><div class="t-val ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${yenSigned(net)}</div><div class="t-sub">${tr('prev.month', { v: yenSigned(pnet) })}</div></div>
        </div>
      </section>
      ${compositionCard(list)}
      ${trendCard()}
      ${recentCard(list)}
      <div class="spacer"></div>`;
  }

  function compositionCard(list) {
    const kind = ui.compKind;
    const tot = catTotals(list, kind);
    const total = sum([...tot.values()]);
    const slots = colorSlots(kind);
    const pal = series();
    const rows = [...tot.entries()].sort((a, b) => b[1] - a[1]);
    const segs = [];
    let other = 0;
    for (const [id, v] of rows) {
      if (slots.has(id)) { const c = catIdx.get(id); segs.push({ id, v, name: cName(c), color: pal[slots.get(id)] }); }
      else other += v;
    }
    if (other > 0) segs.push({ id: '_other', v: other, name: tr('other'), color: otherGray() });
    const rowHtml = rows.map(([id, v]) => {
      const c = catIdx.get(id);
      const color = slots.has(id) ? pal[slots.get(id)] : otherGray();
      const act = id === '_none' ? '' : `data-act="filter-cat" data-id="${esc(id)}"`;
      return `<button class="rank-row" ${act}><span class="dot" style="background:${color}"></span><span class="r-icon">${esc(c ? c.icon : '❔')}</span><span class="r-name">${esc(cName(c))}</span><span class="r-pct">${pct(v, total)}</span><span class="r-amt">${yen(v)}</span><span class="chev">›</span></button>`;
    }).join('');
    return `<section class="card">
      <div class="card-head"><h2>${tr('comp.title', { k: kindName(kind) })}</h2>${segmented('comp', [['out', kindName('out')], ['in', kindName('in')]], kind)}</div>
      ${total > 0 ? `<div class="donut-wrap">${donutSVG(segs, total, kind)}</div><div class="rank">${rowHtml}</div>` : `<div class="empty">${tr('comp.empty', { k: kindName(kind) })}</div>`}
    </section>`;
  }

  function trendCard() {
    const kind = ui.compKind;
    const end = ui.month;
    let start = addMonths(end, -11);
    const sm = startMonth();
    if (sm > start) start = sm;
    if (start > end) start = end;
    const months = monthsBetween(start, end);
    const winTot = new Map();
    for (const e of data.entries) {
      const m = e.date.slice(0, 7);
      if (e.kind === kind && e.amount > 0 && m >= start && m <= end && e.cat && catIdx.has(e.cat)) winTot.set(e.cat, (winTot.get(e.cat) || 0) + e.amount);
    }
    const opts = [...winTot.entries()].sort((a, b) => b[1] - a[1] || catOrder(a[0]) - catOrder(b[0])).map(([id]) => id);
    if (!opts.length) return '';
    const sel = ui.trendCat && opts.includes(ui.trendCat) ? ui.trendCat : opts[0];
    const c = catIdx.get(sel);
    const vals = months.map((m) => data.entries.reduce((s, e) => s + (e.kind === kind && e.cat === sel && e.date.slice(0, 7) === m ? e.amount : 0), 0));
    const recorded = months.filter((m) => data.entries.some((e) => e.date.slice(0, 7) === m));
    const recVals = months.map((m, i) => (recorded.includes(m) ? vals[i] : null)).filter((v) => v !== null);
    const avg = recVals.length ? sum(recVals) / recVals.length : 0;
    const tip = ui.trendTip && months.includes(ui.trendTip) ? ui.trendTip : end;
    const tipVal = vals[months.indexOf(tip)];
    const chips = opts.map((id) => { const x = catIdx.get(id); return `<button class="chip ${id === sel ? 'on' : ''}" data-act="trend-cat" data-id="${esc(id)}">${esc(x.icon)} ${esc(cName(x))}</button>`; }).join('');
    const multi = months.length >= 2;
    return `<section class="card">
      <div class="card-head"><h2>${tr('trend.title', { k: kindName(kind) })}</h2>${multi ? `<span class="muted" style="font-size:12.5px">${tr('trend.tap')}</span>` : ''}</div>
      <div class="chips">${chips}</div>
      <div class="trend-top">
        <div><div class="t-label">${ymLabel(tip)} · ${esc(cName(c))}</div><div class="t-big">${yen(tipVal)}</div></div>
        ${multi ? `<div class="avg-box"><div class="t-label">${tr('trend.avg')}</div><div class="t-mid">${yen(avg)}</div></div>` : ''}
      </div>
      ${multi ? barsSVG(months, vals, avg, tip) : `<p class="hint">${tr('trend.wait')}</p>`}
    </section>`;
  }

  function recentCard(list) {
    const items = [...list].sort(cmpDesc).slice(0, 6);
    return `<section class="card">
      <div class="card-head"><h2>${tr('recent.title')}</h2><span class="muted" style="font-size:12.5px">${tr('count', { n: list.length })}</span></div>
      ${items.length ? `<div class="rows">${items.map(entryRow).join('')}</div>${list.length > items.length ? `<button class="more-link" data-act="go-list">${tr('recent.all')}</button>` : ''}` : `<div class="empty">${tr('recent.empty')}</div>`}
    </section>`;
  }

  function renderList() {
    const ym = ui.month, f = ui.filter;
    let list = inMonth(ym);
    if (f.kind !== 'all') list = list.filter((e) => e.kind === f.kind);
    if (f.cat) list = list.filter((e) => e.cat === f.cat);
    if (f.acc) list = list.filter((e) => e.acc === f.acc || e.to === f.acc);
    list.sort(cmpDesc);
    const tags = [];
    if (f.cat) { const c = catIdx.get(f.cat); tags.push(`<button class="ftag" data-act="clear-filter">${esc(c ? c.icon + ' ' + cName(c) : tr('list.category'))} <b>✕</b></button>`); }
    if (f.acc) { const a = accIdx.get(f.acc); tags.push(`<button class="ftag" data-act="clear-filter">${esc(a ? aName(a) : tr('list.account'))} <b>✕</b></button>`); }
    const out = sumKind(list, 'out'), inc = sumKind(list, 'in');
    const groups = new Map();
    for (const e of list) { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); }
    const days = [...groups.entries()].map(([d, arr]) => {
      const dOut = sumKind(arr, 'out'), dIn = sumKind(arr, 'in');
      const s = [dOut ? `${kindName('out')} ${yen(dOut)}` : '', dIn ? `${kindName('in')} ${yen(dIn)}` : ''].filter(Boolean).join(' · ');
      return `<div class="day"><div class="day-head"><span class="${dayDiff(d) === 0 ? 'today' : ''}">${dayLabel(d)}</span><span class="day-sum">${s}</span></div><div class="card"><div class="rows">${arr.map(entryRow).join('')}</div></div></div>`;
    }).join('');
    return `${header(tr('tab.list'), monthSwitcher())}
      <div class="filters">${segmented('listKind', [['all', tr('list.all')], ['out', kindName('out')], ['in', kindName('in')], ['move', kindName('move')]], f.kind)}${tags.join('')}</div>
      <div class="list-sum"><span>${kindName('out')} <b>${yen(out)}</b></span><span>${kindName('in')} <b>${yen(inc)}</b></span><span>${tr('count', { n: list.length })}</span></div>
      ${days || `<section class="card"><div class="empty">${tr('list.empty', { m: ymLabel(ym) })}</div></section>`}`;
  }

  function accCard(a, v, cm) {
    const T = ACC_TYPES[a.type];
    if (a.type === 'credit') {
      const owe = -v;
      return `<button class="acc-card" style="--c:${T.color}" data-act="filter-acc" data-id="${esc(a.id)}"><div class="ac-top"><span class="ac-name">${esc(aName(a))}</span><span class="ac-type">${typeName(a.type)}</span></div><div class="ac-bal"><span class="ac-label">${owe >= 0 ? tr('owed') : tr('balance')}</span>${yen(Math.abs(owe))}</div><div class="ac-foot">${tr('card.usage', { a: yen(cardUsage(a.id, cm)), b: yen(cardUsage(a.id, addMonths(cm, -1))) })}</div></button>`;
    }
    return `<button class="acc-card" style="--c:${T.color}" data-act="filter-acc" data-id="${esc(a.id)}"><div class="ac-top"><span class="ac-name">${esc(aName(a))}</span><span class="ac-type">${typeName(a.type)}</span></div><div class="ac-bal">${yen(v)}</div></button>`;
  }

  function renderAssets() {
    const t = todayStr(), cm = curMonth();
    const bal = balances(t);
    let assetSum = 0, debt = 0;
    for (const a of data.accounts) { const v = bal.get(a.id) || 0; if (a.type === 'credit') debt -= v; else assetSum += v; }
    const net = assetSum - debt;
    const sm = startMonth();
    const hasPrev = sm < cm;
    const pnet = hasPrev ? netOf(balances(monthEnd(addMonths(cm, -1)))) : null;
    const delta = hasPrev ? net - pnet : null;
    const future = data.entries.filter((e) => e.date > t).length;
    const shown = data.accounts.filter((a) => !a.hidden || (bal.get(a.id) || 0) !== 0);
    const groups = data.typeOrder.map((type) => ({ type, list: shown.filter((a) => a.type === type) })).filter((g) => g.list.length);
    const cards = groups.map((g) => `<div class="acc-group"><div class="ag-title">${typeName(g.type)}</div>${g.list.map((a) => accCard(a, bal.get(a.id) || 0, cm)).join('')}</div>`).join('');

    const months = monthsBetween(sm > cm ? cm : sm, cm).slice(-12);
    const vals = months.map((m) => netOf(balances(m === cm ? t : monthEnd(m))));
    const trend = months.length >= 2
      ? lineSVG(months, vals)
      : `<div class="empty">${tr('assets.trendWait')}</div>`;

    const byType = new Map();
    for (const a of data.accounts) {
      if (a.type === 'credit') continue;
      const v = bal.get(a.id) || 0;
      if (v > 0) byType.set(a.type, (byType.get(a.type) || 0) + v);
    }
    const compTotal = sum([...byType.values()]);
    const compTypes = COMP_ORDER.filter((tp) => byType.has(tp));
    const pal = series();
    const comp = compTotal > 0
      ? `<div class="stack" role="img" aria-label="${tr('assets.comp')}">${compTypes.map((tp) => `<span style="flex:${byType.get(tp)};background:${pal[ACC_TYPES[tp].slot]}" title="${typeName(tp)}"></span>`).join('')}</div>
         ${compTypes.map((tp) => `<div class="legend-row"><span class="sw" style="background:${pal[ACC_TYPES[tp].slot]}"></span><span class="ln">${typeName(tp)}</span><span class="lp">${pct(byType.get(tp), compTotal)}</span><span class="lv">${yen(byType.get(tp))}</span></div>`).join('')}`
      : `<div class="empty">${tr('assets.noPositive')}</div>`;

    return `${header(tr('tab.assets'), `<span class="muted" style="font-size:13px">${tr('assets.asOf', { d: mdw(t) })}</span>`)}
      <section class="card">
        <div class="sum-label">${tr('assets.net')}</div>
        <div class="hero-row"><div class="hero">${yen(net)}</div>${delta !== null ? `<span class="delta ${delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''}">${tr('assets.delta', { v: yenSigned(delta) })}</span>` : ''}</div>
        <div class="tiles">
          <div class="tile"><div class="t-label">${tr('assets.assets')}</div><div class="t-val">${yen(assetSum)}</div></div>
          <div class="tile"><div class="t-label">${tr('assets.debt')}</div><div class="t-val">${yen(debt)}</div></div>
        </div>
        ${future ? `<p class="hint">${tr('assets.future', { n: future })}</p>` : ''}
      </section>
      ${cards ? `<div class="ag-bar"><h2>${tr('assets.accounts')}</h2><button class="text-btn strong" data-act="sort-accs">${tr('sort.btn')}</button></div>${cards}` : `<section class="card"><div class="empty">${tr('assets.noAcc')}</div></section>`}
      <section class="card"><div class="card-head"><h2>${tr('assets.trend')}</h2><span class="muted" style="font-size:12.5px">${tr('assets.monthEnd')}</span></div>${trend}</section>
      <section class="card"><div class="card-head"><h2>${tr('assets.comp')}</h2></div>${comp}</section>
      <div class="spacer"></div>`;
  }

  function renderSettings() {
    const bal = balances(todayStr());
    const accRows = orderedAccs().map((a) => {
      const T = ACC_TYPES[a.type];
      const cur = bal.get(a.id) ?? a.initial;
      const now = a.type === 'credit' && cur <= 0 ? `${tr('owed')} ${yen(-cur)}` : `${tr('balance')} ${yen(cur)}`;
      return `<button class="list-row" data-act="acc-edit" data-id="${esc(a.id)}"><i class="badge" style="background:${T.color}">${T.icon}</i><span class="lr-main"><span class="lr-title">${esc(aName(a))}${a.hidden ? `<em class="tag">${tr('common.hiddenTag')}</em>` : ''}</span><span class="lr-sub">${typeName(a.type)} · ${now}</span></span><span class="chev">›</span></button>`;
    }).join('');
    const cats = data.categories.filter((c) => c.kind === ui.setKind);
    const catRows = cats.map((c) => `<button class="list-row" data-act="cat-edit" data-id="${esc(c.id)}"><i class="emoji">${esc(c.icon)}</i><span class="lr-main"><span class="lr-title">${esc(cName(c))}${c.hidden ? `<em class="tag">${tr('common.hiddenTag')}</em>` : ''}</span></span><span class="chev">›</span></button>`).join('');
    const days = backupDays();
    const bstate = days === null ? tr('set.bNever') : `${tr('set.bLast')}<b>${days === 0 ? tr('set.bToday') : tr('set.bDays', { n: days })}</b>`;
    return `${header(tr('tab.settings'))}
      <section class="card"><div class="card-head"><h2>${tr('set.accounts')}</h2><div class="head-btns"><button class="text-btn" data-act="sort-accs">${tr('sort.btn')}</button><button class="text-btn strong" data-act="acc-edit">${tr('common.add')}</button></div></div>
        <div class="list">${accRows || `<div class="empty">${tr('set.noAcc')}</div>`}</div>
        <p class="hint">${tr('set.cardHint')}</p>
      </section>
      <section class="card"><div class="card-head"><h2>${tr('set.categories')}</h2>${segmented('setKind', [['out', kindName('out')], ['in', kindName('in')]], ui.setKind)}</div>
        <div class="list">${catRows || `<div class="empty">${tr('set.noCat')}</div>`}</div>
        <button class="btn ghost full" data-act="cat-edit">${tr(ui.setKind === 'in' ? 'set.addIn' : 'set.addOut')}</button>
      </section>
      <section class="card"><div class="card-head"><h2>${tr('set.prefs')}</h2></div>
        <label class="switch-row"><span>${tr('set.autoAdd')}</span><input type="checkbox" data-input="autoadd" ${ui.autoAdd ? 'checked' : ''}></label>
      </section>
      <section class="card"><div class="card-head"><h2>${tr('ai.title')}</h2></div>
        <p class="hint ai-state">${tr(aiKey() ? 'ai.on' : 'ai.off')}</p>
        <button class="btn ghost full" data-act="ai-setup">${tr(aiKey() ? 'ai.change' : 'ai.setup')}</button>
      </section>
      <section class="card"><div class="card-head"><h2>${tr('set.backup')}</h2></div>
        <p class="backup-state">${bstate}</p>
        <div class="btn-col">
          <button class="btn primary full" data-act="export">${tr('set.export')}</button>
          <button class="btn ghost full" data-act="copy-backup">${tr('set.copy')}</button>
          <label class="btn ghost full" for="file-in">${tr('set.importFile')}</label>
          <button class="btn ghost full" data-act="paste-import">${tr('set.paste')}</button>
          <button class="btn ghost full" data-act="export-csv">${tr('set.csv')}</button>
        </div>
        <input type="file" id="file-in" accept=".json,.csv,.txt,application/json,text/csv,text/plain" hidden>
        <p class="hint">${tr('set.backupHint')}</p>
      </section>
      <section class="card"><div class="card-head"><h2>${tr('set.lang')}</h2></div>
        ${segmented('lang', [['zh', '中文'], ['ja', '日本語'], ['en', 'English']], LANG, 'full')}
      </section>
      <section class="card about"><div>${tr('about', { v: APP_VERSION })}</div><div class="muted" id="persist-state"></div></section>`;
  }
  function updatePersistState() {
    const el = $('#persist-state');
    if (!el) return;
    try {
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then((p) => { if ($('#persist-state')) $('#persist-state').textContent = p ? tr('persist.yes') : tr('persist.no'); }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  /* ================= sheets & dialogs ================= */
  const sheetRoot = $('#sheet-root');
  let sheetEl = null, sheetType = null, pendingReload = false;
  function openSheet(type, html, full) {
    sheetRoot.innerHTML = `<div class="sheet-backdrop" data-act="backdrop"></div><div class="sheet ${full ? 'full' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    sheetRoot.classList.add('open');
    sheetEl = $('.sheet', sheetRoot);
    sheetType = type;
    void sheetRoot.offsetWidth;
    sheetRoot.classList.add('show');
  }
  function closeSheet() {
    if (!sheetRoot.classList.contains('open')) return;
    endScanJob();
    aaEdit = null;
    sheetRoot.classList.remove('show');
    sheetType = null;
    const el = sheetEl;
    setTimeout(() => {
      if (sheetEl !== el) return;
      sheetRoot.classList.remove('open');
      sheetRoot.innerHTML = '';
      sheetEl = null;
      if (pendingReload) location.reload();
    }, 220);
  }
  const modalRoot = $('#modal-root');
  function askConfirm(msg, okText = tr('common.ok'), danger = false) {
    return new Promise((resolve) => {
      modalRoot.innerHTML = `<div class="modal-backdrop" data-m="0"></div><div class="modal" role="alertdialog" aria-modal="true"><div class="m-msg">${esc(msg)}</div><div class="m-btns"><button class="m-btn" data-m="0">${esc(tr('common.cancel'))}</button><button class="m-btn ${danger ? 'danger' : 'strong'}" data-m="1">${esc(okText)}</button></div></div>`;
      modalRoot.classList.add('open');
      const onClick = (ev) => {
        const b = ev.target.closest('[data-m]');
        if (!b) return;
        ev.stopPropagation();
        modalRoot.removeEventListener('click', onClick);
        modalRoot.classList.remove('open');
        modalRoot.innerHTML = '';
        resolve(b.dataset.m === '1');
      };
      modalRoot.addEventListener('click', onClick);
    });
  }
  let toastTimer = null, toastFn = null;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button data-act="toast-action">${esc(action.label)}</button>` : ''}`;
    el.classList.add('show');
    toastFn = action ? action.fn : null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); toastFn = null; }, action ? 5000 : 2200);
  }
  function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }

  /* ================= entry sheet ================= */
  let draft = null;
  function openEntry(entry) {
    if (entry) {
      draft = { id: entry.id, kind: entry.kind, amt: String(entry.amount), cat: entry.cat, acc: entry.acc, to: entry.to, date: entry.date, memo: entry.memo || '' };
      /* an AA expense is edited as its total bill, with the split it was saved with */
      if (entry.aa && entry.aa.t) { draft.amt = String(entry.aa.t); draft.aa = { n: entry.aa.n, g: entry.aa.g, t: entry.aa.t, p: entry.aa.p || [] }; }
    } else {
      const acc = ui.lastAccAny && accIdx.has(ui.lastAccAny) && !accIdx.get(ui.lastAccAny).hidden ? ui.lastAccAny : firstAcc();
      draft = { id: null, kind: 'out', amt: '', cat: null, acc, to: null, date: todayStr(), memo: '' };
    }
    openSheet('entry', entryHTML(), true);
  }
  function renderEntry() { if (sheetEl && sheetType === 'entry') sheetEl.innerHTML = entryHTML(); }
  function accChips(field, selected, exclude) {
    const list = activeAccs(selected).filter((a) => a.id !== exclude || a.id === selected);
    if (!list.length) return `<div class="hint" style="margin:4px 4px 0">${tr('entry.noAcc')}</div>`;
    return list.map((a) => { const T = ACC_TYPES[a.type]; return `<button class="acc-chip ${a.id === selected ? 'on' : ''}" data-act="pick-acc" data-field="${field}" data-id="${esc(a.id)}"><i style="background:${T.color}">${T.icon}</i>${esc(aName(a))}</button>`; }).join('');
  }
  function entryHTML() {
    const d = draft;
    const kinds = ['out', 'in', 'move'].map((k) => [k, kindName(k)]).map(([v, l]) => `<button class="k-${v} ${d.kind === v ? 'on' : ''}" data-act="kind" data-v="${v}">${l}</button>`).join('');
    let body;
    if (d.kind === 'move') {
      body = `<div class="move-box"><div class="e-label">${tr('entry.from')}</div><div class="acc-row" data-row="acc">${accChips('acc', d.acc, null)}</div><div class="move-arrow">↓</div><div class="e-label">${tr('entry.to')}</div><div class="acc-row" data-row="to">${accChips('to', d.to, null)}</div></div>`;
    } else {
      const cats = data.categories.filter((c) => c.kind === d.kind && (!c.hidden || c.id === d.cat));
      body = cats.length
        ? `<div class="cat-grid">${cats.map((c) => `<button class="cat-cell ${c.id === d.cat ? 'on' : ''}" data-act="pick-cat" data-id="${esc(c.id)}"><span class="ce">${esc(c.icon)}</span><span class="cn">${esc(cName(c))}</span></button>`).join('')}</div>`
        : `<div class="empty">${tr('entry.noCat')}</div>`;
    }
    const accRow = d.kind === 'move' ? '' : `<div class="e-label">${d.kind === 'in' ? tr('entry.received') : tr('entry.paid')}</div><div class="acc-row" data-row="acc">${accChips('acc', d.acc, null)}</div>`;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del'].map((k) => `<button data-act="key" data-v="${k}" ${k === 'del' ? `class="k-del" aria-label="${tr('common.delete')}"` : ''}>${k === 'del' ? '⌫' : k}</button>`).join('');
    return `<div class="entry">
      <div class="e-top"><button class="icon-btn" data-act="close-sheet" aria-label="${tr('common.close')}">✕</button><div class="e-title">${d.id ? tr('entry.edit') : tr('entry.new')}</div>${d.id ? `<button class="text-btn danger" data-act="del-entry">${tr('common.delete')}</button>` : '<span class="e-sp"></span>'}</div>
      <div class="kinds">${kinds}</div>
      <div class="amount k-${d.kind} ${d.amt ? '' : 'ph'}">${d.kind === 'move' ? '' : `<span class="amt-tools">${scanButton()}${d.kind === 'out' ? `<button class="aa-btn${d.aa ? ' on' : ''}" data-act="aa-toggle" aria-pressed="${d.aa ? 'true' : 'false'}">AA</button>` : ''}</span>`}<span class="cur">¥</span><span class="num">${d.amt ? Number(d.amt).toLocaleString('ja-JP') : '0'}</span></div>
      ${d.kind === 'out' && d.aa ? `<div class="aa-bar">${aaBarInner(d)}</div>` : ''}
      <div class="e-body">${body}</div>
      ${accRow}
      <div class="e-meta"><label class="date-chip">📅 <span class="date-text">${shortDate(d.date)}</span><input type="date" value="${d.date}" data-input="date" aria-label="${tr('entry.date')}"></label><input class="memo" type="text" placeholder="${tr('entry.memo')}" value="${esc(d.memo)}" data-input="memo" maxlength="40" enterkeyhint="done"></div>
      <div class="keypad">${keys}</div>
      <div class="e-actions"><button class="btn ghost" data-act="save" data-v="cont">${d.id ? tr('common.cancel') : tr('entry.saveCont')}</button><button class="btn primary" data-act="save">${tr('common.save')}</button></div>
    </div>`;
  }
  function updateAmount() {
    const el = sheetEl && $('.amount', sheetEl);
    if (!el) return;
    $('.num', el).textContent = draft.amt ? Number(draft.amt).toLocaleString('ja-JP') : '0';
    el.classList.toggle('ph', !draft.amt);
    const bar = $('.aa-bar', sheetEl);
    if (bar) bar.innerHTML = aaBarInner(draft);
  }
  /* AA bar under the amount: people count and your even share */
  const aaShare = (total, n) => Math.round(total / n);
  const aaBarInner = (d) => `<span class="aa-tag">AA</span><button data-act="aa-n" data-v="-1" aria-label="−">−</button><b class="aa-n">${tr('aa.people', { n: d.aa.n })}</b><button data-act="aa-n" data-v="1" aria-label="+">+</button><span class="aa-mine">${tr('aa.mine', { v: yen(aaShare(parseInt(d.amt || '0', 10), d.aa.n)) })}</span>`;
  function pressKey(k) {
    let s = draft.amt;
    if (k === 'del') s = s.slice(0, -1);
    else { s = (s + k).replace(/^0+/, ''); if (s.length > 10) return shake($('.amount', sheetEl)); }
    draft.amt = s;
    updateAmount();
  }
  function setChipOn(rowSel, attr, id) {
    $$(rowSel, sheetEl).forEach((b) => b.classList.toggle('on', b.dataset[attr] === id));
  }
  /* "−¥573 便利店 · Seven-Eleven Japan" */
  const entryDesc = (e) => `${e.kind === 'in' || e.kind === 'adj' ? '+' : e.kind === 'out' ? '−' : ''}${yen(e.amount)} ${e.kind === 'move' ? kindName('move') : e.kind === 'adj' ? tr('aa.extra') : cName(catIdx.get(e.cat))}${e.memo ? ` · ${e.memo}` : ''}${e.aa && e.aa.t ? tr('aa.descT', { t: yen(e.aa.t) }) : ''}`;
  const sameDayAmount = (date, amount, kind) => data.entries.find((e) => e.date === date && e.kind === kind && (e.amount === amount || (e.aa && e.aa.t === amount)));
  async function saveDraft(cont) {
    const d = draft;
    const amount = parseInt(d.amt || '0', 10);
    if (!amount) { shake($('.amount', sheetEl)); return toast(tr('entry.needAmount')); }
    if (d.kind !== 'move' && (!d.cat || !catIdx.has(d.cat))) { shake($('.e-body', sheetEl)); return toast(tr('entry.needCat')); }
    if (!d.acc || !accIdx.has(d.acc)) return toast(tr(d.kind === 'move' ? 'entry.needFrom' : 'entry.needAcc'));
    if (d.kind === 'move') {
      if (!d.to || !accIdx.has(d.to)) return toast(tr('entry.needTo'));
      if (d.to === d.acc) return toast(tr('entry.same'));
    }
    const existing = d.id ? data.entries.find((e) => e.id === d.id) : null;
    if (!existing) {
      /* the same amount on the same day is often the same purchase entered twice: ask first */
      const same = sameDayAmount(d.date || todayStr(), amount, d.kind);
      if (same && !(await askConfirm(tr('dup.ask', { d: shortDate(d.date || todayStr()), w: entryDesc(same) }), tr('dup.go')))) return;
    }
    /* AA: next, who paid back how much and where */
    if (d.kind === 'out' && d.aa) return openAA(cont);
    /* no longer AA (switched off, or not an expense any more): drop the pay-back transfers and the mark */
    if (existing && existing.aa) {
      const g = existing.aa.g;
      data.entries = data.entries.filter((e) => !(e.aa && e.aa.g === g && e.id !== existing.id));
      delete existing.aa;
    }
    const rec = {
      id: d.id || uid(), date: d.date || todayStr(), amount, kind: d.kind,
      cat: d.kind === 'move' ? null : d.cat, acc: d.acc, to: d.kind === 'move' ? d.to : null,
      memo: (d.memo || '').trim(), ts: existing ? existing.ts : Date.now(),
    };
    if (existing) Object.assign(existing, rec); else data.entries.push(rec);
    ui.lastAccAny = d.kind === 'move' ? ui.lastAccAny : d.acc;
    saveUI();
    saveData();
    const c = catIdx.get(rec.cat);
    const what = rec.kind === 'move' ? `${kindName('move')} ${yen(amount)}` : `${rec.kind === 'in' ? '+' : '−'}${yen(amount)} ${c ? cName(c) : ''}`;
    if (rec.date.slice(0, 7) !== ui.month) ui.month = rec.date.slice(0, 7);
    if (cont && !existing) {
      draft = { id: null, kind: d.kind, amt: '', cat: null, acc: d.acc, to: d.to, date: d.date, memo: '' };
      renderEntry();
      toast(tr('entry.savedCont', { w: what }));
    } else {
      closeSheet();
      toast(existing ? tr('entry.savedEdit') : tr('entry.saved', { w: what }));
    }
    render();
  }
  async function deleteDraft() {
    const d = draft;
    if (!d || !d.id) return;
    const target = data.entries.find((e) => e.id === d.id);
    if (!target) return;
    /* an AA expense goes together with its pay-back transfers */
    const g = target.aa && target.aa.g;
    const group = g ? data.entries.filter((e) => e.aa && e.aa.g === g) : [target];
    const k = group.filter((e) => e.kind !== 'out').length;
    const ok = await askConfirm(g && k ? tr('aa.delAsk', { k, n: k }) : tr('entry.delAsk'), tr('common.delete'), true);
    if (!ok) return;
    data.entries = data.entries.filter((e) => !group.includes(e));
    saveData();
    closeSheet();
    render();
    toast(tr('entry.deleted'), { label: tr('common.undo'), fn: () => { data.entries.push(...group.filter((e) => !data.entries.includes(e))); saveData(); render(); toast(tr('entry.restored')); } });
  }

  /* ================= AA: split the bill ================= */
  /* The whole bill leaves the account that paid it. Your share is the expense; what each friend pays back is a
     transfer from that account to the account the money came back to (PayPay, cash …), so it is neither
     income nor spending. All of it carries the same AA group id and is edited or deleted together. */
  let aaEdit = null;
  function openAA(cont) {
    const d = draft, total = parseInt(d.amt, 10), n = d.aa.n;
    const kept = d.aa.p && d.aa.p.length === n - 1 && d.aa.t === total ? d.aa.p : null;
    const mine = aaShare(total, n), rest = total - mine, base = Math.floor(rest / (n - 1)), extra = rest - base * (n - 1);
    const def = ui.aaAcc && accIdx.has(ui.aaAcc) && !accIdx.get(ui.aaAcc).hidden ? ui.aaAcc : '';
    aaEdit = {
      d, cont: !!cont, total, n,
      persons: kept ? kept.map((p) => ({ a: p.a && accIdx.has(p.a) ? p.a : '', v: String(p.v) }))
        : Array.from({ length: n - 1 }, (_, i) => ({ a: def, v: String(base + (i < extra ? 1 : 0)) })),
    };
    openSheet('aa', aaHTML());
  }
  /* your share is what the friends did not cover; it never goes below ¥0 */
  const aaPaid = (s) => s.persons.reduce((m, p) => m + (parseInt(p.v, 10) || 0), 0);
  const aaMine = (s) => Math.max(0, s.total - aaPaid(s));
  function aaMineHTML(s) {
    const over = aaPaid(s) - s.total, c = catIdx.get(s.d.cat);
    return over > 0 ? esc(tr('aa.over', { x: yen(over) })) : esc(tr('aa.mineBox', { v: yen(aaMine(s)), c: cName(c) }));
  }
  function aaHTML() {
    const s = aaEdit, payer = accIdx.get(s.d.acc);
    const opts = (sel) => (sel ? '' : `<option value="">${tr('aa.accPh')}</option>`) + activeAccs(sel).map((a) => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(aName(a))}</option>`).join('');
    return `<div class="form aa-form">
      <div class="f-top"><button class="icon-btn" data-act="aa-back" aria-label="${tr('common.close')}">✕</button><div class="e-title">${tr('aa.title', { n: s.n })}</div><button class="text-btn strong" data-act="aa-save">${tr('common.save')}</button></div>
      <div class="f-body">
        <p class="aa-sum">${esc(tr('aa.total', { v: yen(s.total), a: aName(payer) }))}</p>
        <div class="e-label">${tr('aa.others', { n: s.n - 1 })}</div>
        <div class="aa-people">${s.persons.map((p, i) => `<div class="aa-p"><span class="aa-who">${tr('aa.who', { i: i + 1 })}</span><select data-aa="acc" data-i="${i}" aria-label="${tr('aa.accPh')}">${opts(p.a)}</select><input type="text" inputmode="numeric" data-aa="amt" data-i="${i}" value="${esc(p.v)}" aria-label="${tr('aa.amtLabel')}"></div>`).join('')}</div>
        <div class="aa-mine-box">${aaMineHTML(s)}</div>
        <p class="hint">${esc(tr('aa.note', { a: aName(payer) }))}</p>
      </div></div>`;
  }
  function aaInput(el) {
    const s = aaEdit, i = Number(el.dataset.i), p = s.persons[i];
    if (!p) return;
    if (el.dataset.aa === 'amt') {
      p.v = el.value.replace(/[^\d]/g, '').slice(0, 10);
      if (el.value !== p.v) el.value = p.v;
    } else {
      p.a = el.value;
      if (p.a) {
        ui.aaAcc = p.a; saveUI();
        /* the first choice fills the people not chosen yet; each can still be changed */
        s.persons.forEach((q, j) => { if (!q.a && j !== i) { q.a = p.a; const sel = $(`select[data-aa="acc"][data-i="${j}"]`, sheetEl); if (sel) sel.value = p.a; } });
      }
    }
    $('.aa-mine-box', sheetEl).innerHTML = aaMineHTML(s);
  }
  function aaBack() {
    const s = aaEdit;
    aaEdit = null;
    if (!s) return closeSheet();
    draft = s.d;
    openSheet('entry', entryHTML(), true);
  }
  function commitAA() {
    const s = aaEdit;
    if (!s) return;
    const d = s.d;
    const persons = s.persons.map((p) => ({ a: p.a, v: parseInt(p.v, 10) || 0 }));
    if (persons.some((p) => !p.a || !accIdx.has(p.a))) return toast(tr('aa.needAcc'));
    if (persons.some((p) => !(p.v > 0))) return toast(tr('aa.needAmt'));
    const mine = aaMine(s);
    const existing = d.id ? data.entries.find((e) => e.id === d.id) : null;
    const g = (existing && existing.aa && existing.aa.g) || uid();
    const date = d.date || todayStr(), memo = (d.memo || '').trim(), ts = existing ? existing.ts : Date.now();
    /* rebuild the group: your share, then for each friend the part of the bill they covered (a transfer from the
       account that paid, unless they paid back into that same account) and anything beyond the bill (balance only) */
    data.entries = data.entries.filter((e) => !(e.aa && e.aa.g === g && e.kind !== 'out'));
    const main = { id: d.id || uid(), date, amount: mine, kind: 'out', cat: d.cat, acc: d.acc, to: null, memo, ts, aa: { g, n: s.n, t: s.total, p: persons } };
    const at = existing ? data.entries.findIndex((e) => e.id === existing.id) : -1;
    if (at >= 0) data.entries[at] = main; else data.entries.push(main);
    const label = memo || cName(catIdx.get(d.cat));
    let left = s.total;
    persons.forEach((p, i) => {
      const cover = Math.min(p.v, left), extra = p.v - cover;
      left -= cover;
      if (cover > 0 && p.a !== d.acc) data.entries.push({ id: uid(), date, amount: cover, kind: 'move', cat: null, acc: d.acc, to: p.a, memo: label, ts: ts - 1 - i, aa: { g } });
      if (extra > 0) data.entries.push({ id: uid(), date, amount: extra, kind: 'adj', cat: null, acc: p.a, to: null, memo: label, ts: ts - 1 - i, aa: { g } });
    });
    ui.lastAccAny = d.acc;
    saveUI();
    saveData();
    if (date.slice(0, 7) !== ui.month) ui.month = date.slice(0, 7);
    aaEdit = null;
    const msg = tr('aa.saved', { v: yen(mine), t: yen(s.total), n: s.n });
    const undo = existing ? null : { label: tr('common.undo'), fn: () => { data.entries = data.entries.filter((e) => !(e.aa && e.aa.g === g)); saveData(); render(); toast(tr('entry.restored')); } };
    if (s.cont && !existing) {
      draft = { id: null, kind: 'out', amt: '', cat: null, acc: d.acc, to: d.to, date: d.date, memo: '' };
      openSheet('entry', entryHTML(), true);
    } else {
      closeSheet();
    }
    render();
    if (existing) toast(tr('entry.savedEdit')); else toast(msg, undo);
  }

  /* ================= settings forms ================= */
  /* The account form asks for today's balance (what the bank / card app shows). For an existing
     account the difference from the recorded balance is booked today as 特殊收入 / 特殊支出
     (or, with the switch off, folded into the starting balance so it never shows up as income/spending). */
  const balLabel = (credit) => tr(credit ? 'acc.oweNow' : 'acc.balNow');
  const balHint = (credit) => tr(credit ? 'acc.oweHint' : 'acc.balHint');
  const ADJ_SYS = { in: 'adj-in', out: 'adj-out' }, ADJ_BASE = { in: 'adjIn', out: 'adjOut' };
  const adjFind = (kind) => data.categories.find((x) => x.sys === ADJ_SYS[kind]) || data.categories.find((x) => x.kind === kind && x.base === ADJ_BASE[kind]);
  const adjName = (kind) => { const c = adjFind(kind); return c ? cName(c) : BASE_CATS[ADJ_BASE[kind]][LANG]; };
  function adjCat(kind) {
    let c = adjFind(kind);
    if (!c) {
      const b = BASE_CATS[ADJ_BASE[kind]];
      c = { id: uid(), name: b[LANG], base: ADJ_BASE[kind], lang0: LANG, kind, icon: b.icon, hidden: false };
      data.categories.push(c);
    }
    c.sys = ADJ_SYS[kind];
    return c;
  }
  /* typed balance minus recorded balance for the open account form (0 when unchanged or new) */
  function accFormDiff() {
    const form = $('.form', sheetEl);
    if (!form || !form.dataset.id) return 0;
    const n = readSigned($('#f-init', sheetEl).value);
    if (n === null) return 0;
    const now = form.dataset.type === 'credit' ? -n : n;
    return now - (balances(todayStr()).get(form.dataset.id) ?? 0);
  }
  function updateAdjNote() {
    const note = $('#f-adj-note', sheetEl);
    if (!note) return;
    const diff = accFormDiff();
    note.hidden = !diff;
    if (!diff) return;
    const credit = $('.form', sheetEl).dataset.type === 'credit';
    const v = yen(Math.abs(diff));
    const what = credit ? tr(diff < 0 ? 'adj.oweMore' : 'adj.oweLess', { v }) : tr(diff > 0 ? 'adj.more' : 'adj.less', { v });
    note.textContent = what + ($('#f-adj', sheetEl).checked ? tr('adj.book', { c: adjName(diff > 0 ? 'in' : 'out') }) : tr('adj.initial'));
  }
  function accFormHTML(a) {
    const isNew = !a;
    const x = a || { id: '', name: '', type: 'bank', initial: 0, hidden: false };
    const credit = x.type === 'credit';
    const cur = isNew ? 0 : (balances(todayStr()).get(x.id) ?? x.initial);
    const initVal = signedStr(credit ? -cur : cur);
    return `<div class="form" data-type="${x.type}" data-id="${esc(x.id)}">
      <div class="f-top"><button class="icon-btn" data-act="close-sheet" aria-label="${tr('common.close')}">✕</button><div class="e-title">${isNew ? tr('acc.add') : tr('acc.edit')}</div><button class="text-btn strong" data-act="acc-save" data-id="${esc(x.id)}">${tr('common.save')}</button></div>
      <div class="f-body">
        <label class="field"><span>${tr('common.name')}</span><input type="text" id="f-name" value="${esc(aName(x))}" maxlength="24" placeholder="${esc(tr('acc.namePh'))}"></label>
        <p class="hint name-hint">${tr(isNew ? 'name.hintNew' : 'name.hint', { l: LANG_NAME[LANG] })}</p>
        <div class="field"><span>${tr('acc.type')}</span><div class="type-grid">${ACC_ORDER.map((t) => `<button class="type-opt ${t === x.type ? 'on' : ''}" data-act="pick-type" data-v="${t}"><i style="background:${ACC_TYPES[t].color}">${ACC_TYPES[t].icon}</i>${typeName(t)}</button>`).join('')}</div></div>
        <label class="field"><span id="f-init-label">${balLabel(credit)}</span><input type="text" id="f-init" inputmode="numeric" value="${initVal}" placeholder="0"></label>
        <p class="hint" id="f-init-hint">${balHint(credit)}</p>
        ${isNew ? '' : `<p class="hint adj-note" id="f-adj-note" hidden></p>
        <label class="switch-row"><span>${tr('acc.adjSwitch')}<small>${tr('acc.adjSwitchSub')}</small></span><input type="checkbox" id="f-adj" ${data.entries.length ? 'checked' : ''}></label>
        <label class="switch-row"><span>${tr('common.hide')}</span><input type="checkbox" id="f-hidden" ${x.hidden ? 'checked' : ''}></label>
        <div class="f-row"><button class="btn ghost sm" data-act="sort-accs">${tr('sort.btn')}</button><span class="grow"></span><button class="btn ghost sm danger" data-act="acc-del" data-id="${esc(x.id)}">${tr('common.delete')}</button></div>`}
      </div>
    </div>`;
  }
  function catFormHTML(c) {
    const isNew = !c;
    const x = c || { id: '', name: '', kind: ui.setKind, icon: ui.setKind === 'in' ? '💰' : '📦', hidden: false };
    const kindLocked = !isNew && usedCat(x.id) > 0;
    return `<div class="form" data-kind="${x.kind}">
      <div class="f-top"><button class="icon-btn" data-act="close-sheet" aria-label="${tr('common.close')}">✕</button><div class="e-title">${isNew ? tr('cat.add') : tr('cat.edit')}</div><button class="text-btn strong" data-act="cat-save" data-id="${esc(x.id)}">${tr('common.save')}</button></div>
      <div class="f-body">
        <div class="field"><span>${tr('cat.kind')}</span>${kindLocked ? `<div class="muted">${kindName(x.kind)}${tr('cat.locked')}</div>` : `<div class="seg" id="f-kind">${[['out', kindName('out')], ['in', kindName('in')]].map(([v, l]) => `<button class="${v === x.kind ? 'on' : ''}" data-act="pick-kind" data-v="${v}">${l}</button>`).join('')}</div>`}</div>
        <label class="field"><span>${tr('common.name')}</span><input type="text" id="f-name" value="${esc(cName(x))}" maxlength="20" placeholder="${esc(tr('cat.namePh'))}"></label>
        <p class="hint name-hint">${tr(isNew ? 'name.hintNew' : 'name.hint', { l: LANG_NAME[LANG] })}</p>
        <div class="field"><span>${tr('cat.icon')}</span><div class="icon-input"><input type="text" id="f-icon" value="${esc(x.icon)}" maxlength="8"></div>
          <div class="emoji-grid">${EMOJIS.map((e) => `<button data-act="pick-emoji" data-v="${e}">${e}</button>`).join('')}</div></div>
        ${isNew ? '' : `<label class="switch-row"><span>${tr('common.hide')}</span><input type="checkbox" id="f-hidden" ${x.hidden ? 'checked' : ''}></label>
        <div class="f-row"><button class="btn ghost sm" data-act="move-item" data-what="cat" data-id="${esc(x.id)}" data-v="-1">${tr('common.up')}</button><button class="btn ghost sm" data-act="move-item" data-what="cat" data-id="${esc(x.id)}" data-v="1">${tr('common.down')}</button><span class="grow"></span><button class="btn ghost sm danger" data-act="cat-del" data-id="${esc(x.id)}">${tr('common.delete')}</button></div>`}
      </div>
    </div>`;
  }
  function commit() { reindex(); saveData(); render(); }
  function saveAccForm(id) {
    const form = $('.form', sheetEl);
    const name = $('#f-name', sheetEl).value.trim();
    if (!name) { shake($('#f-name', sheetEl)); return toast(tr('common.enterName')); }
    if (data.accounts.some((a) => aName(a) === name && a.id !== id)) return toast(tr('acc.dupe'));
    const type = form.dataset.type;
    let made = null;
    if (id) {
      const a = accIdx.get(id);
      const diff = accFormDiff();
      setLabel(a, 'acc', name);
      Object.assign(a, { type, hidden: $('#f-hidden', sheetEl) ? $('#f-hidden', sheetEl).checked : a.hidden });
      if (diff && $('#f-adj', sheetEl).checked) {
        const kind = diff > 0 ? 'in' : 'out';
        made = { id: uid(), date: todayStr(), amount: Math.abs(diff), kind, cat: adjCat(kind).id, acc: id, to: null, memo: '', ts: Date.now() };
        data.entries.push(made);
      } else if (diff) {
        a.initial += diff;
      }
    } else {
      const n = readSigned($('#f-init', sheetEl).value) || 0;
      data.accounts.push({ id: uid(), name, lang0: LANG, type, initial: type === 'credit' ? -n : n, hidden: false });
    }
    commit();
    closeSheet();
    if (!made) return toast(tr('common.saved'));
    const mc = catIdx.get(made.cat);
    const v = `${made.kind === 'in' ? '+' : '−'}${yen(made.amount)}`;
    toast(tr('adj.done', { c: mc ? cName(mc) : '', v }), { label: tr('common.undo'), fn: () => {
      const i = data.entries.indexOf(made);
      if (i >= 0) data.entries.splice(i, 1);
      commit();
      toast(tr('common.undone'));
    } });
  }
  function saveCatForm(id) {
    const form = $('.form', sheetEl);
    const name = $('#f-name', sheetEl).value.trim();
    const icon = $('#f-icon', sheetEl).value.trim() || '📦';
    const kind = form.dataset.kind === 'in' ? 'in' : 'out';
    if (!name) { shake($('#f-name', sheetEl)); return toast(tr('common.enterName')); }
    if (data.categories.some((c) => cName(c) === name && c.kind === kind && c.id !== id)) return toast(tr('cat.dupe'));
    if (id) {
      const c = catIdx.get(id);
      setLabel(c, 'cat', name);
      Object.assign(c, { icon, kind: usedCat(id) ? c.kind : kind, hidden: $('#f-hidden', sheetEl) ? $('#f-hidden', sheetEl).checked : c.hidden });
    } else {
      data.categories.push({ id: uid(), name, lang0: LANG, kind, icon, hidden: false });
    }
    ui.setKind = kind;
    commit();
    closeSheet();
    toast(tr('common.saved'));
  }
  function moveItem(what, id, dir) {
    /* categories only; accounts are ordered in the reorder sheet */
    const arr = data.categories, i = arr.findIndex((c) => c.id === id);
    if (i < 0) return;
    const kind = arr[i].kind;
    let j = i + dir;
    while (j >= 0 && j < arr.length && arr[j].kind !== kind) j += dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    commit();
    toast(tr(dir < 0 ? 'common.movedUp' : 'common.movedDown'));
  }

  /* ================= receipt scan (Gemini, the user's own key) ================= */
  /* The key lives in its own storage entry so it never ends up in a backup file. Photos go
     straight from the phone to Google; nothing passes through any server of ours. */
  const AI_STORE = 'kakeibo:ai';
  const AI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
  /* free-tier models, fastest first: on the free tier the bigger Flash models often take a minute or more
     (or answer 503), while Flash-Lite replies in seconds. If Google retires them all, the models list is asked. */
  const AI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash'];
  const aiState = () => { try { return JSON.parse(localStorage.getItem(AI_STORE) || '{}') || {}; } catch (e) { return {}; } };
  const aiKey = () => String(aiState().key || '');
  function saveAi(patch) { try { localStorage.setItem(AI_STORE, JSON.stringify(Object.assign(aiState(), patch))); } catch (e) { /* storage full */ } }
  const scanButton = () => (aiKey()
    ? `<label class="scan-btn" for="photo-in">📷 <span>${tr('ai.scan')}</span></label><input type="file" id="photo-in" accept="image/*" multiple class="vh">`
    : `<button class="scan-btn" data-act="ai-setup">📷 <span>${tr('ai.scan')}</span></button>`);
  function aiFormHTML() {
    const key = aiKey();
    return `<div class="form">
      <div class="f-top"><button class="icon-btn" data-act="close-sheet" aria-label="${tr('common.close')}">✕</button><div class="e-title">${tr('ai.setupTitle')}</div><button class="text-btn strong" data-act="ai-save">${tr('common.save')}</button></div>
      <div class="f-body">
        <p class="hint" style="margin-top:0">${tr('ai.off')}</p>
        <ol class="ai-steps"><li>${tr('ai.step1')}<br><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></li><li>${tr('ai.step2')}</li></ol>
        <label class="field"><span>${tr('ai.keyLabel')}</span><input type="password" id="ai-key" value="${esc(key)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="AIza…"></label>
        <p class="hint">${tr('ai.privacy')}</p>
        ${key ? `<button class="btn ghost full danger ai-remove" data-act="ai-clear">${tr('ai.remove')}</button>` : ''}
      </div></div>`;
  }
  async function aiFetch(key, path, body, signal) {
    let r;
    try {
      r = await fetch(`${AI_BASE}/${path}`, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal }
        : { headers: { 'x-goog-api-key': key }, signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      const err = new Error(navigator.onLine === false ? 'offline' : 'network');
      err.status = 0;
      throw err;
    }
    let j = null;
    try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (!r.ok) {
      const err = new Error((j && j.error && j.error.message) || `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return j || {};
  }
  /* flash models from the account's model list, newest first, lite (faster) before full flash */
  async function aiListModels(key, signal) {
    const j = await aiFetch(key, 'models?pageSize=200', null, signal);
    const ver = (n) => Number((/(\d+(?:\.\d+)?)/.exec(n) || [0, 0])[1]);
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((n) => /flash/.test(n) && !/(live|tts|image|audio|embed|transcrib|translat)/.test(n))
      .sort((a, b) => ver(b) - ver(a) || /lite/.test(b) - /lite/.test(a));
  }
  async function saveAiKey() {
    const inp = $('#ai-key', sheetEl);
    const key = String(inp.value || '').trim();
    if (!key) { shake(inp); return toast(tr('ai.enterKey')); }
    toast(tr('ai.checking'));
    try {
      const names = await aiListModels(key);
      saveAi({ key, model: AI_MODELS.find((m) => names.includes(m)) || names[0] || '' });
      toast(tr('ai.saved'));
    } catch (e) {
      if ([400, 401, 403].includes(e.status)) { shake(inp); return toast(tr('ai.badKey')); }
      saveAi({ key });
      toast(tr('ai.savedUnchecked'));
    }
    closeSheet();
    render();
  }
  /* A photo or an ordinary screenshot goes as one JPEG, longest side 1600px, which keeps receipt text readable.
     A long screenshot (taller than 2.4× its width) would turn unreadable if shrunk whole, so it is cut into
     overlapping slices 900px wide instead. */
  const MAX_FILES = 10, MAX_PARTS = 20;
  function imageParts(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      const fail = () => { URL.revokeObjectURL(url); reject(Object.assign(new Error('image'), { status: -1 })); };
      img.onload = () => {
        const w = img.naturalWidth, h = img.naturalHeight, out = [];
        if (!w || !h) return fail();
        const jpeg = (y, sh, k) => {
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * k));
          c.height = Math.max(1, Math.round(sh * k));
          c.getContext('2d').drawImage(img, 0, y, w, sh, 0, 0, c.width, c.height);
          const u = c.toDataURL('image/jpeg', 0.85);
          return { mime: 'image/jpeg', data: u.slice(u.indexOf(',') + 1) };
        };
        if (h <= w * 2.4) out.push(jpeg(0, h, Math.min(1, 1600 / Math.max(w, h))));
        else {
          const k = Math.min(1, 900 / w), slice = Math.round(w * 1.9), step = slice - Math.round(slice * 0.15);
          for (let y = 0; ; y += step) {
            const sh = Math.min(slice, h - y);
            out.push(jpeg(y, sh, k));
            if (y + sh >= h || out.length > MAX_PARTS) break;
          }
        }
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = fail;
      img.src = url;
    });
  }
  function scanPrompt(nImages = 1) {
    const list = (kind) => data.categories.filter((c) => c.kind === kind && !c.hidden)
      .map((c) => `${c.id}: ${[...new Set(allLabels(c, 'cat'))].join(' / ')}`).join('\n');
    const accs = activeAccs().map((a) => `${a.id}: ${[...new Set(allLabels(a, 'acc'))].join(' / ')} (${a.type})`).join('\n');
    const byBase = (k) => data.categories.find((c) => c.base === k && !c.hidden);
    const conb = byBase('conbini'), food = byBase('food');
    return [
      'Read this image for a household budget app kept in Japanese yen. It can be a Japanese receipt, a payment screen, or a screenshot that lists several transactions (PayPay 取引履歴, WeChat Pay 微信支付 payment notices, a card or bank app).',
      nImages > 1 ? `There are ${nImages} images, in order. They can be consecutive screenshots or slices of one long screenshot, and they may overlap: list each transaction only once.` : '',
      'Reply with JSON only, in this shape:',
      '{"items": [{"type": "payment" | "refund" | "income" | "transfer" | "points" | "failed", "amount": integer, "date": "YYYY-MM-DD", "time": "HH:MM", "merchant": string, "via": string, "category": a category id, "from": an account id, "to": an account id, "currency": a currency code}]}',
      'Leave out any field that is unknown or does not apply, to keep the reply short: currency only when the amount is not in yen, from and to only for transfers.',
      'One item per transaction, in the order shown. A receipt is a single transaction.',
      'amount: in Japanese yen, digits only. On a receipt, the total actually paid, tax included, after discounts (合計, お支払い, ご請求額), not the subtotal, 預り or お釣り.',
      'On WeChat Pay or Alipay notices the large "¥" figure is Chinese yuan: use the yen price instead (标价 … 日元). Only if a transaction shows no yen amount at all, give its amount with the currency as shown.',
      'type: "payment" for money paid, including 支払い完了, 支払い受付 and money sent to a person; "refund" for 返金 / 退款; "income" for money received (受け取り, 收款, salary); "transfer" for top-ups, charges and withdrawals between the user\'s own accounts (チャージ, 充值, 提现, 出金); "points" for points or coupons (pt, ポイント付与); "failed" for failed or cancelled payments (支払い失敗, キャンセル, 取消, 失败, a struck-through amount).',
      'date: the transaction date. Convert Japanese era years (令和8年 is 2026). Relative labels count back from today: 今天/今日/Today, 昨天/昨日/Yesterday, 前天/一昨日; a weekday name (星期二, 火曜日, Tue) is the latest such day before today; a time alone (9:30) means today. Leave it out if the date cannot be told.',
      'time: the time of day if shown.',
      'merchant: the shop or other party as shown (on WeChat Pay, the name at the top of the notice), at most 20 characters.',
      'via: the payment source if shown (残高, 残高カード, PayPayカード, a card name).',
      'Leave out a transaction that is cut off so that its amount or its merchant cannot be seen.',
      'category (payments, refunds and income only): an id from the lists below, only when you are fairly sure which one fits; otherwise leave it out, and the user will choose.',
      conb ? `Convenience stores (7-Eleven / セブン-イレブン / Seven-Eleven Japan, FamilyMart / ファミリーマート, Lawson / ローソン, Ministop, Daily Yamazaki, NewDays, Seicomart …) are ${conb.id}.` : '',
      food ? `Supermarkets and grocery stores (AEON / イオン, 西友, ライフ, まいばすけっと, OK / オーケー, サミット, マルエツ, 業務スーパー …) are ${food.id}.` : '',
      'from / to (transfers only): the ids of the accounts below that the money leaves and enters, when you can tell; for example 三菱ＵＦＪ銀行からのチャージ on a PayPay screen goes from the 三菱UFJ bank account to the PayPay account. Leave out the one you cannot tell.',
      `Today is ${todayStr()} (${WEEK.en[new Date().getDay()]}).`,
      'Expense categories:', list('out'), 'Income categories:', list('in'), 'Accounts:', accs,
      'If nothing can be read, reply {"items": []}.',
    ].filter(Boolean).join('\n');
  }
  /* The model writes {"items": [{…}, {…}]} a piece at a time. This pulls out each transaction object
     as soon as its closing brace arrives, so it can be shown before the rest is written. */
  function itemScanner(onItem) {
    let text = '', pos = 0, inStr = false, escNext = false;
    const stack = [];
    return {
      push(chunk) {
        text += chunk;
        for (; pos < text.length; pos++) {
          const c = text[pos];
          if (inStr) { if (escNext) escNext = false; else if (c === '\\') escNext = true; else if (c === '"') inStr = false; continue; }
          if (c === '"') inStr = true;
          else if (c === '{' || c === '[') {
            /* an object directly inside the items array (or a bare top-level array) is one transaction */
            const parent = stack[stack.length - 1];
            stack.push({ c, start: pos, item: c === '{' && !!parent && parent.c === '[' && stack.length <= 2 });
          } else if (c === '}' || c === ']') {
            const top = stack.pop();
            if (top && top.item && c === '}') { let o = null; try { o = JSON.parse(text.slice(top.start, pos + 1)); } catch (e) { /* malformed piece */ } if (o) onItem(o); }
          }
        }
      },
      text: () => text,
    };
  }
  /* the whole reply, for answers that are not an items list (an older single-object shape) */
  function looseJSON(text) {
    const t = String(text || '').trim(), a = t.search(/[[{]/);
    if (a < 0) return null;
    const close = t[a] === '[' ? ']' : '}', b = t.lastIndexOf(close);
    if (b <= a) return null;
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return null; }
  }
  /* One streamed request (server-sent events) to one model. XHR rather than fetch, because it reports
     upload progress as well as the reply arriving in pieces. Calls back: up(loaded, total), sent(), text(piece). */
  function aiStream(job, key, model, body, cb) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify(body);
      const xhr = new XMLHttpRequest();
      job.xhr = xhr;
      let seen = 0, buf = '', settled = false;
      const fail = (msg, status) => { if (settled) return; settled = true; reject(Object.assign(new Error(msg), { status })); };
      const event = (raw) => {
        const data = raw.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
        if (!data) return;
        let j;
        try { j = JSON.parse(data); } catch (e) { return; }
        if (j.error) { fail(j.error.message || 'error', j.error.code || 500); try { xhr.abort(); } catch (e) { /* gone */ } return; }
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        const piece = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
        if (piece) cb.text(piece);
      };
      const pump = (final) => {
        const t = xhr.responseText || '';
        if (t.length > seen) { buf += t.slice(seen); seen = t.length; }
        let m;
        while (!settled && (m = /\r?\n\r?\n/.exec(buf))) { const ev = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length); event(ev); }
        if (final && !settled && buf.trim()) { event(buf); buf = ''; }
      };
      xhr.open('POST', `${AI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('x-goog-api-key', key);
      xhr.upload.onprogress = (e) => cb.up(e.loaded, e.lengthComputable && e.total ? e.total : payload.length);
      xhr.upload.onload = () => cb.sent();
      xhr.onprogress = () => { cb.alive(); if (xhr.status === 200) { cb.sent(); pump(false); } };
      xhr.onload = () => {
        if (settled) return;
        /* any answer at all means the upload went through */
        cb.sent();
        if (xhr.status === 200) { pump(true); if (!settled) { settled = true; resolve(); } return; }
        let j = null;
        try { j = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (Array.isArray(j)) j = j[0];
        fail((j && j.error && j.error.message) || `HTTP ${xhr.status}`, xhr.status);
      };
      xhr.onerror = () => fail(navigator.onLine === false ? 'offline' : 'network', 0);
      xhr.onabort = () => { if (settled) return; settled = true; reject(Object.assign(new Error('abort'), { name: 'AbortError' })); };
      xhr.send(payload);
    });
  }
  /* a date the model gave that is plausible for a purchase: a real day, not far in the future or past */
  const okDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && ymd(parseYMD(v)) === v && dayDiff(v) <= 1 && dayDiff(v) >= -400;
  const SCAN_TYPES = ['payment', 'refund', 'income', 'transfer', 'points', 'failed'];
  const YEN_CODES = ['JPY', 'YEN', '円', '日元', '¥', '￥', 'JP¥'];
  /* every transaction the model listed, tidied; `skip` says why one is not offered (points, failed, no yen amount) */
  function scanItems(o) {
    const raw = Array.isArray(o) ? o : o && Array.isArray(o.items) ? o.items : o && typeof o === 'object' && o.amount != null ? [o] : [];
    const accOk = (v) => (v != null && accIdx.has(String(v)) && !accIdx.get(String(v)).hidden ? String(v) : null);
    const out = [];
    for (const x of raw) {
      if (!x || typeof x !== 'object') continue;
      const num = Number(String(x.amount != null ? x.amount : '').replace(/[^\d.]/g, ''));
      if (!(num > 0)) continue;
      const type = SCAN_TYPES.includes(x.type) ? x.type : x.kind === 'in' ? 'income' : 'payment';
      const isYen = YEN_CODES.includes(String(x.currency || 'JPY').trim().toUpperCase()) && Number.isInteger(num);
      const kind = type === 'transfer' ? 'move' : type === 'refund' || type === 'income' ? 'in' : 'out';
      const cat = kind === 'move' ? null : data.categories.find((c) => c.id === x.category && c.kind === kind && !c.hidden);
      const to = kind === 'move' ? accOk(x.to) : null, from = kind === 'move' ? accOk(x.from) : null;
      const time = /^\d{1,2}:\d{2}$/.test(String(x.time || '')) ? String(x.time).padStart(5, '0') : null;
      out.push({
        skip: !isYen ? 'foreign' : type === 'points' || type === 'failed' ? type : null,
        kind, amount: Math.min(Math.round(num), 9999999999), date: okDate(x.date) ? x.date : null, time,
        merchant: String(x.merchant || '').trim().slice(0, 40), via: String(x.via || '').trim().slice(0, 20),
        cat: cat ? cat.id : null, from: from && from !== to ? from : null, to,
      });
    }
    return out;
  }
  function skipSummary(counts) {
    return ['points', 'failed', 'foreign'].filter((k) => counts[k]).map((k) => tr(`scan.sk.${k}`, { n: counts[k] })).join(tr('scan.sep'));
  }
  /* fill the entry sheet from one recognised transaction ("edit in New entry") */
  function applyScan(x, d, skipped) {
    d.amt = String(x.amount);
    if (x.date) d.date = x.date;
    if (x.kind === 'move') {
      /* a charge or top-up: the accounts the AI recognised; what it could not tell is left for the user */
      const to = x.to || d.acc || null;
      d.kind = 'move'; d.cat = null; d.to = to; d.acc = x.from && x.from !== to ? x.from : null;
    } else {
      d.kind = x.kind;
      /* a category the AI is unsure about stays empty for the user to pick */
      if (x.cat) { d.cat = x.cat; d.aiCat = x.cat; }
      else if (d.cat && (d.cat === d.aiCat || !catIdx.has(d.cat) || catIdx.get(d.cat).kind !== d.kind)) d.cat = null;
      /* the payment method is left exactly as the user chose it */
    }
    /* the shop name goes into the note unless the user already typed their own */
    if (x.merchant && (!d.memo || d.memo === d.aiMemo)) { d.memo = x.merchant; d.aiMemo = x.merchant; }
    renderEntry();
    toast(skipped ? tr('ai.doneSkip', { s: skipped }) : tr('ai.done'));
  }

  /* ---- the scan page: what is happening (images, upload, AI) and each transaction as soon as it is read ---- */
  /* a stage only gives up after this many seconds without any progress, not after a fixed total */
  const SCAN_LIMITS = { upStall: 30, switchAfter: 25, firstReply: 120, idle: 60 };
  let scanJob = null;
  const mb = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const secs = (t) => Math.max(0, Math.round((Date.now() - t) / 1000));
  function scanPageHTML(j) {
    const accs = activeAccs(j.acc);
    return `<div class="form scanlist">
      <div class="f-top"><button class="icon-btn" data-act="sl-back" aria-label="${tr('common.close')}">✕</button><div class="e-title">${tr('scan.title')}</div><span class="e-sp"></span></div>
      <div class="f-body">
        <section class="scan-status">
          <div class="ss-thumbs">${j.thumbs.map((u) => `<img src="${u}" alt="">`).join('')}</div>
          <ol class="ss-steps">${['prep', 'upload', 'ai'].map((k) => `<li class="ss-step wait" data-step="${k}"><i class="ss-i"></i><span class="ss-t">${tr(`ss.${k}`)}</span><span class="ss-v"></span>${k === 'upload' ? '<span class="ss-bar"><b></b></span>' : ''}</li>`).join('')}</ol>
          <p class="ss-note"></p>
          <div class="ss-msg"></div>
        </section>
        <label class="field"><span>${tr('entry.paid')}</span>${accs.length ? `<select class="sl-acc" data-sl="acc">${accs.map((a) => `<option value="${esc(a.id)}"${a.id === j.acc ? ' selected' : ''}>${esc(aName(a))}</option>`).join('')}</select>` : `<div class="hint">${tr('entry.noAcc')}</div>`}</label>
        <div class="sl-list"><p class="hint sl-empty">${tr('ss.waiting')}</p></div>
        <p class="hint sl-skips"></p>
        <p class="hint">${tr('scan.hint')}</p>
      </div>
      <div class="sl-foot"><button class="btn ghost sl-fill" data-act="sl-fill" hidden>${tr('ss.fill')}</button><button class="btn primary sl-add" data-act="sl-add" disabled>${tr('scan.add', { n: 0 })}</button></div>
    </div>`;
  }
  const rowNotes = (r) => [
    r.same ? `<em class="tag warn">${esc(tr('scan.same', { w: r.same }))}</em>` : '',
    r.aaSame ? `<em class="tag warn">${esc(tr('scan.aaSame', { w: r.aaSame }))}</em>` : '',
    r.twin ? `<em class="tag warn">${tr('scan.twin')}</em>` : '',
    r.noDate ? `<em class="tag warn">${tr('scan.noDate')}</em>` : '',
    r.via ? `<span>${esc(r.via)}</span>` : ''].join('');
  function rowHTML(r, i) {
    const accOpts = (sel, ph) => (sel ? '' : `<option value="">${ph}</option>`) + activeAccs(sel).map((a) => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(aName(a))}</option>`).join('');
    const catOpts = (r.cat ? '' : `<option value="">${tr('scan.pickCat')}</option>`) + data.categories
      .filter((c) => c.kind === r.kind && (!c.hidden || c.id === r.cat))
      .map((c) => `<option value="${esc(c.id)}"${c.id === r.cat ? ' selected' : ''}>${esc(c.icon)} ${esc(cName(c))}</option>`).join('');
    const sign = r.kind === 'in' ? '+' : r.kind === 'out' ? '−' : '⇄ ';
    return `<div class="sl-row new${r.on ? '' : ' off'}">
        <label class="sl-main"><input type="checkbox" data-sl="on" data-i="${i}"${r.on ? ' checked' : ''}><span class="sl-name">${esc(r.merchant || kindName(r.kind))}</span><span class="sl-amt ${r.kind}">${sign}${yen(r.amount)}</span></label>
        <div class="sl-meta"><label class="date-chip${r.noDate ? ' warn' : ''}">📅 <span class="date-text">${shortDate(r.date)}</span><input type="date" value="${r.date}" data-sl="date" data-i="${i}" aria-label="${tr('entry.date')}"></label>${r.kind === 'move' ? `<span class="sl-kind">⇄ ${kindName('move')}</span>` : `<select class="sl-cat" data-sl="cat" data-i="${i}" aria-label="${tr('list.category')}">${catOpts}</select>`}</div>
        ${r.kind === 'move' ? `<div class="sl-move"><select data-sl="from" data-i="${i}" aria-label="${tr('scan.from')}">${accOpts(r.from, tr('scan.from'))}</select><span class="sl-arrow">→</span><select data-sl="to" data-i="${i}" aria-label="${tr('scan.to')}">${accOpts(r.to, tr('scan.to'))}</select></div>` : ''}
        <div class="sl-notes">${rowNotes(r)}</div>
      </div>`;
  }
  const onPage = (j) => j === scanJob && sheetType === 'scan' && sheetEl;
  function setStep(j, k, state, value) {
    if (!onPage(j)) return;
    const li = $(`.ss-step[data-step="${k}"]`, sheetEl);
    li.className = `ss-step ${state}`;
    if (value !== undefined) $('.ss-v', li).textContent = value;
  }
  function setScanMsg(j, text, isErr, retry, extra) {
    if (!onPage(j)) return;
    const el = $('.ss-msg', sheetEl);
    el.className = `ss-msg${isErr ? ' err' : ''}`;
    el.innerHTML = text ? `<span>${esc(text)}${extra ? `<small>${esc(extra)}</small>` : ''}</span>${retry ? `<button class="btn ghost" data-act="ss-retry">${tr('ss.retry')}</button>` : ''}` : '';
  }
  function setScanNote(j, text) { if (onPage(j)) $('.ss-note', sheetEl).textContent = text; }
  function refreshScanFoot(j) {
    if (!onPage(j)) return;
    const n = j.rows.filter((r) => r.on).length, ended = j.phase === 'done' || j.phase === 'error';
    const add = $('.sl-add', sheetEl);
    add.textContent = tr('scan.add', { n });
    add.disabled = !n || !ended;
    $('.sl-fill', sheetEl).hidden = !(ended && j.rows.length === 1);
    $('.sl-skips', sheetEl).textContent = skipSummary(j.skips) ? tr('scan.skipped', { s: skipSummary(j.skips) }) : '';
  }
  /* the AI line: which model, how long it has been */
  function refreshAiStep(j) {
    if (j.phase === 'wait') setStep(j, 'ai', 'on', tr('ss.wait', { m: j.model, s: secs(j.tWait) }));
    else if (j.phase === 'recv') setStep(j, 'ai', 'on', tr('ss.recv', { n: j.rows.length, s: secs(j.tSend) }));
  }
  function addScanItem(j, raw) {
    if (j !== scanJob) return;
    const [x] = scanItems([raw]);
    if (!x) return;
    if (x.skip) { j.skips[x.skip] = (j.skips[x.skip] || 0) + 1; refreshScanFoot(j); return; }
    const d = j.draft, date = x.date || d.date || todayStr(), same = sameDayAmount(date, x.amount, x.kind);
    /* the same transaction seen twice, e.g. in two overlapping screenshots */
    const twin = j.rows.some((r) => r.date === date && r.amount === x.amount && r.kind === x.kind && (!r.time || !x.time || r.time === x.time));
    const to = x.kind === 'move' ? x.to || d.acc || null : null;
    /* money received that matches an AA pay-back recorded within two weeks is probably the same money */
    const days = (a, b) => Math.abs(Math.round((parseYMD(a) - parseYMD(b)) / 86400000));
    const aaHit = x.kind === 'in' ? data.entries.find((e) => e.kind === 'out' && e.aa && (e.aa.p || []).some((q) => q.v === x.amount) && days(e.date, date) <= 14) : null;
    const r = Object.assign({}, x, { date, noDate: !x.date, same: same ? entryDesc(same) : '', twin, aaSame: aaHit ? `${yen(x.amount)} · ${aaHit.memo || cName(catIdx.get(aaHit.cat))}` : '', on: !same && !twin && !aaHit, to, from: x.from && x.from !== to ? x.from : null });
    j.rows.push(r);
    if (onPage(j)) {
      const list = $('.sl-list', sheetEl), ph = $('.sl-empty', list);
      if (ph) ph.remove();
      list.insertAdjacentHTML('beforeend', rowHTML(r, j.rows.length - 1));
    }
    refreshAiStep(j);
    refreshScanFoot(j);
  }
  function endScanJob() {
    const j = scanJob;
    if (!j) return;
    scanJob = null;
    clearInterval(j.tick);
    if (j.xhr) { try { j.xhr.abort(); } catch (e) { /* already done */ } }
    j.thumbs.forEach((u) => URL.revokeObjectURL(u));
  }
  /* once a second: elapsed time, and give up on a stage that has stopped moving */
  function tickScan(j) {
    if (j !== scanJob) return clearInterval(j.tick);
    refreshAiStep(j);
    const L = SCAN_LIMITS, now = Date.now();
    /* a model that has not started answering: try the next one rather than keep waiting */
    if (j.phase === 'wait' && j.hasNext && now - j.tWait > L.switchAfter * 1000 && j.xhr) { j.slow = L.switchAfter; try { j.xhr.abort(); } catch (e) { /* gone */ } return; }
    let why = null;
    if (j.phase === 'upload' && now - j.last > L.upStall * 1000) why = tr('ss.stallUp');
    else if (j.phase === 'wait' && now - j.tWait > L.firstReply * 1000) why = tr('ss.stallAi', { s: L.firstReply });
    else if (j.phase === 'recv' && now - j.last > L.idle * 1000) why = tr('ss.stallAi', { s: L.idle });
    if (why && j.xhr) { j.stall = why; try { j.xhr.abort(); } catch (e) { /* gone */ } }
  }
  async function scanReceipt(fileList) {
    const key = aiKey(), d = draft, files = [...fileList].filter(Boolean);
    if (!key) return openSheet('ai', aiFormHTML());
    if (!d || sheetType !== 'entry' || scanJob || !files.length) return;
    if (files.length > MAX_FILES) return toast(tr('ai.tooMany', { n: MAX_FILES }));
    const j = {
      draft: d, files, thumbs: files.map((f) => URL.createObjectURL(f)), parts: null, acc: d.acc || firstAcc(),
      phase: 'prep', rows: [], skips: {}, model: '', xhr: null, tick: null, stall: null, last: Date.now(), tWait: 0, tSend: 0,
    };
    scanJob = j;
    openSheet('scan', scanPageHTML(j), true);
    /* 1) images: shrink, and cut long screenshots into readable slices */
    const parts = [];
    let bad = 0;
    for (let i = 0; i < files.length; i++) {
      setStep(j, 'prep', 'on', `${i + 1}/${files.length}`);
      try { parts.push(...(await imageParts(files[i]))); } catch (e) { bad++; }
      if (j !== scanJob) return;
    }
    if (!parts.length) { j.phase = 'error'; setStep(j, 'prep', 'err', ''); setScanMsg(j, tr('ai.badImage'), true); return; }
    if (parts.length > MAX_PARTS) { j.phase = 'error'; setStep(j, 'prep', 'err', ''); setScanMsg(j, tr('ai.tooLong'), true); return; }
    const ok = files.length - bad;
    setStep(j, 'prep', 'ok', parts.length > ok ? tr('ss.prepSlices', { n: ok, p: parts.length }) : tr('ss.prepDone', { n: ok }));
    if (bad) setScanNote(j, tr('ss.prepSkip', { n: bad }));
    j.parts = parts;
    runScan(j);
  }
  /* 2) + 3) send to Gemini and read the reply as it streams; on a busy or retired model, try the next one */
  async function runScan(j) {
    const key = aiKey(), st = aiState();
    /* a remembered model only leads when it is one found through the model list (not one of ours) */
    const models = [...new Set([...(st.model && !AI_MODELS.includes(st.model) ? [st.model] : []), ...AI_MODELS])];
    let listed = false, noThink = false;
    j.rows = []; j.skips = {}; j.stall = null;
    if (onPage(j)) { $('.sl-list', sheetEl).innerHTML = `<p class="hint sl-empty">${tr('ss.waiting')}</p>`; setScanMsg(j, ''); }
    clearInterval(j.tick);
    j.tick = setInterval(() => tickScan(j), 1000);
    for (let i = 0; i < models.length; i++) {
      const m = models[i];
      const body = {
        contents: [{ role: 'user', parts: [...j.parts.map((p) => ({ inline_data: { mime_type: p.mime, data: p.data } })), { text: scanPrompt(j.parts.length) }] }],
        generationConfig: noThink ? { responseMimeType: 'application/json' } : { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
      };
      j.model = m; j.phase = 'upload'; j.last = j.tSend = Date.now(); j.stall = null; j.slow = 0; j.hasNext = i < models.length - 1;
      setStep(j, 'upload', 'on', '');
      setStep(j, 'ai', 'wait', '');
      refreshScanFoot(j);
      const scanner = itemScanner((o) => addScanItem(j, o));
      let gotText = false;
      const sent = () => {
        if (j.phase !== 'upload') return;
        j.phase = 'wait'; j.tWait = j.last = Date.now();
        setStep(j, 'upload', 'ok', mb(JSON.stringify(body).length));
        refreshAiStep(j);
      };
      try {
        await aiStream(j, key, m, body, {
          up: (a, b) => {
            j.last = Date.now();
            setStep(j, 'upload', 'on', tr('ss.upPct', { p: Math.min(100, Math.round((a / b) * 100)), a: mb(a), b: mb(b) }));
            if (onPage(j)) $('.ss-bar b', sheetEl).style.width = `${Math.min(100, (a / b) * 100)}%`;
          },
          sent,
          alive: () => { j.last = Date.now(); },
          text: (piece) => {
            if (j !== scanJob) return;
            if (!gotText) { gotText = true; sent(); j.phase = 'recv'; }
            j.last = Date.now();
            scanner.push(piece);
            refreshAiStep(j);
          },
        });
        if (j !== scanJob) return;
        if (!AI_MODELS.includes(m) && m !== st.model) saveAi({ model: m });
        /* an answer that was not an items list: read it whole */
        if (!j.rows.length && !Object.keys(j.skips).length) {
          const o = looseJSON(scanner.text());
          const raws = Array.isArray(o) ? o : o && Array.isArray(o.items) ? o.items : o && typeof o === 'object' ? [o] : [];
          raws.forEach((x) => addScanItem(j, x));
        }
        j.phase = 'done';
        clearInterval(j.tick);
        setStep(j, 'ai', 'ok', tr('ss.done', { s: secs(j.tSend) }));
        const sk = skipSummary(j.skips);
        setScanMsg(j, j.rows.length ? tr('scan.found', { n: j.rows.length }) : sk ? tr('scan.none', { s: sk }) : tr('ss.none'), false);
        refreshScanFoot(j);
        return;
      } catch (e) {
        if (j !== scanJob) return;
        if (e.name === 'AbortError' && j.slow && !gotText && i < models.length - 1) { setScanNote(j, tr('ss.slowSwitch', { a: m, b: models[i + 1], s: j.slow })); continue; }
        if (e.name !== 'AbortError' && !gotText) {
          /* a model that does not take the thinking setting: ask again without it */
          if (e.status === 400 && /think/i.test(e.message) && !noThink) { noThink = true; i--; setScanNote(j, tr('ss.noThink')); continue; }
          if ([404, 429, 500, 503].includes(e.status)) {
            if (i === models.length - 1 && e.status === 404 && !listed) {
              listed = true;
              const more = await aiListModels(key).catch(() => []);
              models.push(...more.filter((x) => !models.includes(x)));
            }
            if (i < models.length - 1) { setScanNote(j, tr('ss.switch', { a: m, b: models[i + 1], c: e.status })); continue; }
          }
        }
        return failScan(j, e, gotText);
      }
    }
  }
  function failScan(j, e, partial) {
    const step = j.phase === 'upload' ? 'upload' : 'ai';
    j.phase = 'error';
    clearInterval(j.tick);
    setStep(j, step, 'err');
    let msg;
    if (e.name === 'AbortError') msg = j.stall || tr('ss.net');
    else if (e.status === 0) msg = e.message === 'offline' ? tr('ai.offline') : tr('ss.net');
    else if (e.status === 429) msg = tr('ai.quota');
    else if ([400, 401, 403].includes(e.status) && /key/i.test(e.message)) msg = tr('ai.badKey');
    else msg = tr('ai.failed', { m: e.message });
    setScanMsg(j, msg, true, true, partial && j.rows.length ? tr('ss.cut') : '');
    refreshScanFoot(j);
  }
  function changeScanList(el) {
    const j = scanJob, f = el.dataset.sl;
    if (f === 'acc') { j.acc = el.value; return; }
    const r = j.rows[Number(el.dataset.i)], rowEl = el.closest('.sl-row');
    if (!r) return;
    if (f === 'on') {
      r.on = el.checked;
      rowEl.classList.toggle('off', !r.on);
      refreshScanFoot(j);
    } else if (f === 'date') {
      if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) {
        r.date = el.value; r.noDate = false;
        const same = sameDayAmount(r.date, r.amount, r.kind);
        r.same = same ? entryDesc(same) : '';
      }
      const chip = el.closest('.date-chip');
      $('.date-text', chip).textContent = shortDate(r.date);
      chip.classList.remove('warn');
      $('.sl-notes', rowEl).innerHTML = rowNotes(r);
    } else if (f === 'cat') {
      r.cat = el.value || null;
    } else if (f === 'from' || f === 'to') {
      r[f] = el.value || null;
    }
  }
  async function backToEntry() {
    const j = scanJob;
    if (!j) return closeSheet();
    if (j.rows.length && !(await askConfirm(tr('scan.discard'), tr('scan.discardBtn'), true))) return;
    if (j !== scanJob) return;
    endScanJob();
    draft = j.draft;
    openSheet('entry', entryHTML(), true);
  }
  function fillFromScan() {
    const j = scanJob;
    if (!j || j.rows.length !== 1) return;
    const r = j.rows[0], sk = skipSummary(j.skips);
    endScanJob();
    draft = j.draft;
    openSheet('entry', entryHTML(), true);
    applyScan(r, draft, sk);
  }
  function addScanList() {
    const j = scanJob;
    if (!j || !(j.phase === 'done' || j.phase === 'error')) return;
    const rows = j.rows.filter((r) => r.on);
    if (!rows.length) return;
    const pay = rows.filter((r) => r.kind !== 'move'), moves = rows.filter((r) => r.kind === 'move');
    const flag = (r, msg) => { shake($$('.sl-row', sheetEl)[j.rows.indexOf(r)]); toast(msg); };
    if (pay.length && (!j.acc || !accIdx.has(j.acc))) return toast(tr('entry.needAcc'));
    const noCat = pay.find((r) => !r.cat || !catIdx.has(r.cat));
    if (noCat) return flag(noCat, tr('scan.needCat'));
    const badMove = moves.find((r) => !r.from || !r.to || r.from === r.to || !accIdx.has(r.from) || !accIdx.has(r.to));
    if (badMove) return flag(badMove, tr('scan.needMove'));
    const now = Date.now();
    const recs = rows.map((r, i) => ({
      id: uid(), date: r.date, amount: r.amount, kind: r.kind, cat: r.kind === 'move' ? null : r.cat,
      acc: r.kind === 'move' ? r.from : j.acc, to: r.kind === 'move' ? r.to : null, memo: r.merchant, ts: now - i,
    }));
    data.entries.push(...recs);
    if (pay.length) { ui.lastAccAny = j.acc; saveUI(); }
    saveData();
    const latest = recs.reduce((m, r) => (r.date > m ? r.date : m), recs[0].date);
    if (latest.slice(0, 7) !== ui.month) ui.month = latest.slice(0, 7);
    endScanJob();
    closeSheet();
    render();
    const ids = new Set(recs.map((r) => r.id));
    toast(tr('scan.added', { n: recs.length }), { label: tr('common.undo'), fn: () => {
      data.entries = data.entries.filter((e) => !ids.has(e.id));
      saveData(); render(); toast(tr('scan.undone'));
    } });
  }

  /* ================= account order (drag to reorder) ================= */
  function sortHTML() {
    const groups = data.typeOrder.map((type) => ({ type, list: data.accounts.filter((a) => a.type === type) })).filter((g) => g.list.length);
    const item = (a) => `<div class="sort-item" data-id="${esc(a.id)}"><i class="badge" style="background:${ACC_TYPES[a.type].color}">${ACC_TYPES[a.type].icon}</i><span class="si-name">${esc(aName(a))}${a.hidden ? `<em class="tag">${tr('common.hiddenTag')}</em>` : ''}</span><span class="drag-h" aria-label="${tr('sort.dragItem')}">≡</span></div>`;
    return `<div class="form sorter">
      <div class="f-top"><span class="e-sp"></span><div class="e-title">${tr('sort.title')}</div><button class="text-btn strong" data-act="close-sheet">${tr('sort.done')}</button></div>
      <div class="f-body">
        <p class="hint sort-hint">${tr('sort.hint')}</p>
        <div class="sort-groups" data-sort="groups">${groups.map((g) => `<section class="sort-group" data-id="${g.type}"><div class="sg-head"><span class="sg-name">${typeName(g.type)}</span><span class="drag-h" aria-label="${tr('sort.dragGroup')}">≡</span></div><div class="sort-list" data-sort="accs">${g.list.map(item).join('')}</div></section>`).join('')}</div>
      </div></div>`;
  }
  /* write the order shown in a dragged list back to the data */
  function commitSort(list) {
    if (list.dataset.sort === 'groups') {
      const types = Array.from(list.children).map((g) => g.dataset.id);
      data.typeOrder = [...types, ...data.typeOrder.filter((t) => !types.includes(t))];
    } else {
      /* the group's accounts take the same slots in data.accounts, in their new order */
      const ids = Array.from(list.children).map((x) => x.dataset.id);
      const want = new Set(ids), byId = new Map(data.accounts.map((a) => [a.id, a]));
      const slots = [];
      data.accounts.forEach((a, i) => { if (want.has(a.id)) slots.push(i); });
      slots.forEach((slot, k) => { data.accounts[slot] = byId.get(ids[k]); });
    }
    reindex();
    saveData();
    render();
  }
  /* Pointer events cover touch on iOS too: the ≡ handle has touch-action: none, so dragging it never scrolls. */
  let drag = null;
  const midY = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
  document.addEventListener('pointerdown', (ev) => {
    const h = ev.target.closest && ev.target.closest('.drag-h');
    if (!h || drag) return;
    const item = h.closest('.sort-item, .sort-group');
    if (!item) return;
    ev.preventDefault();
    try { h.setPointerCapture(ev.pointerId); } catch (e) { /* not an active pointer */ }
    drag = { item, list: item.parentElement, id: ev.pointerId, startY: ev.clientY, top: item.getBoundingClientRect().top, moved: false };
    item.classList.add('dragging');
  });
  document.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    ev.preventDefault();
    const { item, list } = drag;
    item.style.transform = `translateY(${ev.clientY - drag.startY}px)`;
    for (let guard = 0; guard < 50; guard++) {
      const mid = midY(item), next = item.nextElementSibling, prev = item.previousElementSibling;
      if (next && mid > midY(next)) list.insertBefore(next, item);
      else if (prev && mid < midY(prev)) list.insertBefore(item, prev);
      else break;
      /* the row moved in the list: re-anchor it so it stays under the finger */
      item.style.transform = 'none';
      const top = item.getBoundingClientRect().top;
      drag.startY += top - drag.top;
      drag.top = top;
      item.style.transform = `translateY(${ev.clientY - drag.startY}px)`;
      drag.moved = true;
    }
  }, { passive: false });
  const endDrag = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const { item, list, moved } = drag;
    drag = null;
    item.style.transform = '';
    item.classList.remove('dragging');
    if (moved) { commitSort(list); toast(tr('sort.saved')); }
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  async function deleteAcc(id) {
    const n = usedAcc(id);
    if (n) return toast(tr('acc.inUse', { n }));
    if (!(await askConfirm(tr('acc.delAsk'), tr('common.delete'), true))) return;
    data.accounts = data.accounts.filter((a) => a.id !== id);
    commit();
    closeSheet();
  }
  async function deleteCat(id) {
    const n = usedCat(id);
    if (n) return toast(tr('cat.inUse', { n }));
    if (!(await askConfirm(tr('cat.delAsk'), tr('common.delete'), true))) return;
    data.categories = data.categories.filter((c) => c.id !== id);
    commit();
    closeSheet();
  }

  /* ================= backup / import / export ================= */
  function backupJSON() {
    return JSON.stringify({ app: 'kakeibo', version: 1, exportedAt: new Date().toISOString(), categories: data.categories, accounts: data.accounts, typeOrder: data.typeOrder, entries: data.entries, meta: { createdAt: data.meta.createdAt, baseAdded: data.meta.baseAdded } });
  }
  function markBackup() { data.meta.lastBackup = new Date().toISOString(); saveData(); render(); }
  function downloadBlob(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function shareFile(text, name, type) {
    try {
      const file = new File([text], name, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
    }
    downloadBlob(text, name, type);
    return true;
  }
  async function exportBackup() {
    const ok = await shareFile(backupJSON(), `kakeibo-backup-${todayStr()}.json`, 'application/json');
    if (ok) { markBackup(); toast(tr('bk.exported')); }
  }
  async function copyBackup() {
    try {
      await navigator.clipboard.writeText(backupJSON());
      markBackup();
      toast(tr('bk.copied'));
    } catch (e) {
      openPaste(backupJSON(), true);
    }
  }
  const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  async function exportCSV() {
    const rows = [['日期', '内容', '金额', '收支', '分类', '支付方式', '备注']];
    for (const e of [...data.entries].sort((a, b) => -cmpDesc(a, b))) {
      const a = accIdx.get(e.acc), t = accIdx.get(e.to), c = catIdx.get(e.cat);
      if (e.kind === 'adj') { rows.push([e.date.replace(/-/g, '/'), `${e.memo || ''}${tr('aa.extraCsv')}`, e.amount, '收入', '其他收入', a ? labelIn(a, 'acc', 'zh') : '', '']); continue; }
      rows.push([e.date.replace(/-/g, '/'), e.memo, e.amount, CSV_KIND[e.kind], e.kind === 'move' ? (t ? labelIn(t, 'acc', 'zh') : '') : (c ? labelIn(c, 'cat', 'zh') : ''), a ? labelIn(a, 'acc', 'zh') : '', '']);
    }
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    const ok = await shareFile(csv, `kakeibo-${todayStr()}.csv`, 'text/csv');
    if (ok) toast(tr('bk.csvDone'));
  }
  function parseCSV(text) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function guessAccType(name) {
    if (/卡|card|カード/i.test(name)) return 'credit';
    if (/银行|銀行|bank|信金|信用金庫/i.test(name)) return 'bank';
    if (/现金|現金|cash|财布|財布/i.test(name)) return 'cash';
    if (/pay|suica|pasmo|icoca|waon|nanaco|aeon|edy|钱包|楽天|d払い/i.test(name)) return 'ewallet';
    if (/证券|証券|nisa|ideco|股/i.test(name)) return 'securities';
    return 'other';
  }
  function parseCSVImport(text) {
    const rows = parseCSV(text).map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x));
    const hi = rows.findIndex((r) => r.includes('日期') && r.includes('金额'));
    if (hi < 0) throw new Error(tr('imp.noCols'));
    const H = rows[hi];
    const col = (n) => H.indexOf(n);
    const iDate = col('日期'), iMemo = col('内容'), iAmt = col('金额'), iKind = col('收支'), iCat = col('分类'), iAcc = col('支付方式'), iNote = col('备注');
    const cats = data.categories.map((c) => ({ ...c })), accs = data.accounts.map((a) => ({ ...a }));
    const newCats = [], newAccs = [], entries = [];
    let skipped = 0;
    const findAcc = (name) => {
      if (!name) return null;
      let a = accs.find((x) => allLabels(x, 'acc').includes(name));
      if (!a) {
        const type = guessAccType(name), base = findBase('acc', name, type);
        a = { id: uid(), name, lang0: 'zh', type, initial: 0, hidden: false, ...(base ? { base } : {}) };
        accs.push(a); newAccs.push(a);
      }
      return a.id;
    };
    const findCat = (name, kind) => {
      if (!name) return null;
      let c = cats.find((x) => x.kind === kind && allLabels(x, 'cat').includes(name));
      if (!c) {
        const base = findBase('cat', name, kind);
        c = { id: uid(), name, lang0: 'zh', kind, icon: base ? BASE_CATS[base].icon : kind === 'in' ? '💰' : '📦', hidden: false, ...(base ? { base } : {}) };
        cats.push(c); newCats.push(c);
      }
      return c.id;
    };
    for (const r of rows.slice(hi + 1)) {
      const m = /^(\d{4})\D(\d{1,2})\D(\d{1,2})/.exec(r[iDate] || '');
      const amt = Number(String(r[iAmt] || '').replace(/[^\d.\-]/g, ''));
      if (!m || !(amt > 0)) { skipped++; continue; }
      const date = `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
      const kt = iKind >= 0 ? r[iKind] : '';
      const catName = iCat >= 0 ? r[iCat] : '';
      let kind = kt === '收入' ? 'in' : kt === '转移' ? 'move' : kt === '支出' ? 'out' : null;
      if (!kind) kind = cats.some((c) => c.kind === 'in' && allLabels(c, 'cat').includes(catName)) ? 'in' : 'out';
      const memo = [iMemo >= 0 ? r[iMemo] : '', iNote >= 0 ? r[iNote] : ''].filter(Boolean).join(' ');
      const accName = iAcc >= 0 ? r[iAcc] : '';
      if (kind === 'move') {
        if (!accName || !catName) { skipped++; continue; }
        entries.push({ id: uid(), date, amount: Math.round(amt), kind, cat: null, acc: findAcc(accName), to: findAcc(catName), memo, ts: 0 });
      } else {
        if (!accName) { skipped++; continue; }
        entries.push({ id: uid(), date, amount: Math.round(amt), kind, cat: findCat(catName || (kind === 'in' ? '其他收入' : '其他支出'), kind), acc: findAcc(accName), to: null, memo, ts: 0 });
      }
    }
    return { cats, accs, newCats, newAccs, entries, skipped };
  }
  async function importText(raw) {
    const text = String(raw || '').replace(/^﻿/, '').trim();
    if (!text) return toast(tr('imp.empty'));
    if (text[0] === '{') {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { return toast(tr('imp.broken')); }
      if (!validData(obj)) return toast(tr('imp.notOurs'));
      const nd = normalize(obj);
      const ok = await askConfirm(tr('imp.replaceAsk', { e: nd.entries.length, a: nd.accounts.length, c: nd.categories.length }), tr('imp.replaceBtn'), true);
      if (!ok) return;
      nd.meta.lastBackup = new Date().toISOString();
      data = nd;
      reindex();
      saveData();
      closeSheet();
      ui.month = curMonth();
      ui.filter = { kind: 'all', cat: null, acc: null };
      ui.trendCat = null;
      ui.tab = 'home';
      render();
      toast(tr('imp.replaced', { n: nd.entries.length }));
      return;
    }
    let res;
    try { res = parseCSVImport(text); } catch (e) { return toast(e.message || tr('imp.badCsv')); }
    if (!res.entries.length) return toast(tr('imp.noRows'));
    const extra = res.newCats.length || res.newAccs.length ? tr('imp.newItems', { c: res.newCats.length, a: res.newAccs.length }) : '';
    const ok = await askConfirm(tr('imp.appendAsk', { n: res.entries.length }) + extra + (res.skipped ? tr('imp.skip', { n: res.skipped }) : ''), tr('imp.appendBtn'));
    if (!ok) return;
    data.categories = res.cats;
    data.accounts = res.accs;
    data.entries.push(...res.entries);
    reindex();
    saveData();
    closeSheet();
    render();
    toast(tr('imp.appended', { n: res.entries.length }));
  }
  function openPaste(prefill, isExport) {
    openSheet('paste', `<div class="form">
      <div class="f-top"><button class="icon-btn" data-act="close-sheet" aria-label="${tr('common.close')}">✕</button><div class="e-title">${isExport ? tr('paste.export') : tr('paste.import')}</div>${isExport ? '<span class="e-sp"></span>' : `<button class="text-btn strong" data-act="do-paste-import">${tr('paste.go')}</button>`}</div>
      <div class="f-body">
        <label class="field"><span>${isExport ? tr('paste.exportLabel') : tr('paste.importLabel')}</span><textarea id="paste-box" ${isExport ? 'readonly' : ''} placeholder="{&quot;app&quot;:&quot;kakeibo&quot; …">${esc(prefill || '')}</textarea></label>
        ${isExport ? '' : `<p class="hint">${esc(tr('paste.hint'))}</p>`}
      </div></div>`);
  }

  /* ================= events ================= */
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
    switch (act) {
      case 'tab':
        ui.tab = el.dataset.tab;
        if (ui.tab !== 'list') ui.filter = { kind: 'all', cat: null, acc: null };
        render(); view.scrollTop = 0; break;
      case 'add': openEntry(); break;
      case 'month':
        ui.month = v === '0' ? curMonth() : addMonths(ui.month, Number(v));
        ui.trendTip = null; render(); break;
      case 'seg': {
        const s = el.dataset.seg;
        if (s === 'lang') { setLang(v); break; }
        if (s === 'comp') { ui.compKind = v; ui.trendCat = null; ui.trendTip = null; saveUI(); }
        else if (s === 'listKind') ui.filter.kind = v;
        else if (s === 'setKind') ui.setKind = v;
        render(); break;
      }
      case 'filter-cat':
        ui.filter = { kind: 'all', cat: id, acc: null }; ui.tab = 'list'; render(); view.scrollTop = 0; break;
      case 'filter-acc':
        ui.filter = { kind: 'all', cat: null, acc: id }; ui.tab = 'list'; ui.month = curMonth(); render(); view.scrollTop = 0; break;
      case 'clear-filter': ui.filter = { kind: ui.filter.kind, cat: null, acc: null }; render(); break;
      case 'trend-cat': ui.trendCat = id; ui.trendTip = null; saveUI(); render(); break;
      case 'bar': ui.trendTip = v; render(); break;
      case 'edit': {
        const e = data.entries.find((x) => x.id === id);
        /* a friend's AA pay-back opens the AA expense it belongs to */
        const main = e && e.aa && e.kind !== 'out' ? data.entries.find((x) => x.aa && x.aa.g === e.aa.g && x.kind === 'out') : null;
        if (main) openEntry(main);
        else if (e && e.kind === 'adj') askConfirm(tr('aa.delExtra'), tr('common.delete'), true).then((yes) => { if (yes) { data.entries = data.entries.filter((x) => x !== e); saveData(); render(); } });
        else if (e) openEntry(e);
        break;
      }
      case 'go-settings': ui.tab = 'settings'; render(); view.scrollTop = 0; break;
      case 'go-list': ui.tab = 'list'; render(); view.scrollTop = 0; break;
      /* entry sheet */
      case 'kind':
        if (draft.kind === v) break;
        draft.kind = v;
        if (v === 'move') { draft.cat = null; if (!draft.to) { const other = activeAccs().find((a) => a.id !== draft.acc); draft.to = other ? other.id : null; } }
        else if (draft.cat && (!catIdx.has(draft.cat) || catIdx.get(draft.cat).kind !== v)) draft.cat = null;
        renderEntry(); break;
      case 'pick-cat': {
        /* choosing a category never changes the payment method; only the user does */
        draft.cat = id;
        setChipOn('.cat-cell', 'id', id);
        break;
      }
      case 'pick-acc': {
        const field = el.dataset.field;
        draft[field] = id;
        setChipOn(`[data-row="${field}"] .acc-chip`, 'id', id);
        break;
      }
      case 'key': pressKey(v); break;
      case 'aa-toggle':
        draft.aa = draft.aa ? null : { n: Math.min(20, Math.max(2, Number(ui.aaN) || 2)) };
        renderEntry(); break;
      case 'aa-n': {
        if (!draft.aa) break;
        draft.aa.n = Math.min(20, Math.max(2, draft.aa.n + Number(v)));
        ui.aaN = draft.aa.n; saveUI();
        const bar = $('.aa-bar', sheetEl);
        if (bar) bar.innerHTML = aaBarInner(draft);
        break;
      }
      case 'aa-back': aaBack(); break;
      case 'aa-save': commitAA(); break;
      case 'save': if (v === 'cont' && draft.id) closeSheet(); else saveDraft(v === 'cont'); break;
      case 'del-entry': deleteDraft(); break;
      case 'close-sheet': case 'backdrop': closeSheet(); break;
      /* settings */
      case 'acc-edit': openSheet('acc', accFormHTML(id ? accIdx.get(id) : null)); break;
      case 'cat-edit': openSheet('cat', catFormHTML(id ? catIdx.get(id) : null)); break;
      case 'pick-type': {
        const form = $('.form', sheetEl);
        const wasCredit = form.dataset.type === 'credit';
        form.dataset.type = v;
        $$('.type-opt', sheetEl).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
        const credit = v === 'credit';
        if (form.dataset.id && wasCredit !== credit) {
          /* 待还 and 余额 have opposite signs: keep the same balance when switching to / from a card */
          const inp = $('#f-init', sheetEl), n = readSigned(inp.value);
          if (n !== null) inp.value = signedStr(-n);
        }
        $('#f-init-label', sheetEl).textContent = balLabel(credit);
        $('#f-init-hint', sheetEl).textContent = balHint(credit);
        updateAdjNote();
        break;
      }
      case 'pick-kind': {
        const form = $('.form', sheetEl);
        form.dataset.kind = v;
        $$('#f-kind button', sheetEl).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
        break;
      }
      case 'pick-emoji': $('#f-icon', sheetEl).value = v; break;
      case 'acc-save': saveAccForm(id); break;
      case 'cat-save': saveCatForm(id); break;
      case 'acc-del': deleteAcc(id); break;
      case 'cat-del': deleteCat(id); break;
      case 'move-item': moveItem(el.dataset.what, id, Number(v)); break;
      case 'sort-accs': openSheet('sort', sortHTML()); break;
      case 'ai-setup': openSheet('ai', aiFormHTML()); break;
      case 'ai-save': saveAiKey(); break;
      case 'ai-clear': saveAi({ key: '', model: '' }); closeSheet(); render(); toast(tr('ai.removed')); break;
      case 'sl-back': backToEntry(); break;
      case 'sl-add': addScanList(); break;
      case 'sl-fill': fillFromScan(); break;
      case 'ss-retry': if (scanJob && scanJob.parts) runScan(scanJob); break;
      /* data */
      case 'export': exportBackup(); break;
      case 'copy-backup': copyBackup(); break;
      case 'export-csv': exportCSV(); break;
      case 'paste-import': openPaste(''); break;
      case 'do-paste-import': importText($('#paste-box', sheetEl).value); break;
      case 'toast-action': { const fn = toastFn; toastFn = null; $('#toast').classList.remove('show'); if (fn) fn(); break; }
      default: break;
    }
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.input === 'memo' && draft) draft.memo = el.value;
    else if (el.dataset.aa === 'amt' && aaEdit) aaInput(el);
    else if (el.id === 'f-init') updateAdjNote();
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.aa === 'acc' && aaEdit) {
      aaInput(el);
    } else if (el.dataset.sl && scanJob) {
      changeScanList(el);
    } else if (el.dataset.input === 'date' && draft) {
      draft.date = /^\d{4}-\d{2}-\d{2}$/.test(el.value) ? el.value : todayStr();
      const t = $('.date-text', sheetEl);
      if (t) t.textContent = shortDate(draft.date);
    } else if (el.id === 'f-adj') {
      updateAdjNote();
    } else if (el.dataset.input === 'autoadd') {
      ui.autoAdd = el.checked; saveUI(); toast(tr(el.checked ? 'set.autoOn' : 'set.autoOff'));
    } else if (el.id === 'photo-in' && el.files && el.files[0]) {
      const files = [...el.files];
      el.value = '';
      scanReceipt(files);
    } else if (el.id === 'file-in' && el.files && el.files[0]) {
      const file = el.files[0];
      const reader = new FileReader();
      reader.onload = () => importText(reader.result);
      reader.onerror = () => toast(tr('imp.readFail'));
      reader.readAsText(file);
      el.value = '';
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.input === 'memo') ev.target.blur();
  });

  let lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (Math.abs(window.innerWidth - lastW) > 20) { lastW = window.innerWidth; render(); } });
  if (mqDark) {
    const onScheme = () => render();
    if (mqDark.addEventListener) mqDark.addEventListener('change', onScheme); else if (mqDark.addListener) mqDark.addListener(onScheme);
  }
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (ui.month !== curMonth() && hiddenAt && Date.now() - hiddenAt > 6 * 3600 * 1000) ui.month = curMonth();
    render();
    if (ui.autoAdd && hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000 && !sheetType && !modalRoot.classList.contains('open')) openEntry();
  });

  /* ================= service worker (offline) ================= */
  const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && secure) {
    const hadController = !!navigator.serviceWorker.controller;
    const swReg = navigator.serviceWorker.register('./sw.js');
    swReg.catch(() => {});
    /* iOS brings a home-screen app back to the front without reloading it, so check for a new
       version on every return as well (at most once a minute), not only on a cold start. */
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - lastCheck < 60 * 1000) return;
      lastCheck = Date.now();
      swReg.then((r) => r.update()).catch(() => {});
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      if (sheetType) { pendingReload = true; toast(tr('sw.ready')); }
      else location.reload();
    });
  }

  /* ================= language ================= */
  function applyLang() {
    document.documentElement.lang = HTML_LANG[LANG];
    document.title = tr('app.name');
    const nav = $('.tabbar');
    if (nav) nav.setAttribute('aria-label', tr('nav.label'));
    $$('.tabbar [data-tab]').forEach((b) => { const l = $('.tl', b); if (l) l.textContent = tr('tab.' + b.dataset.tab); });
    const plus = $('.tabbar .plus');
    if (plus) plus.setAttribute('aria-label', tr('entry.new'));
  }
  function setLang(v) {
    if (!I18N[v] || v === LANG) return;
    LANG = v;
    saveUI();
    applyLang();
    render();
    toast(tr('set.langDone'));
  }

  /* ================= start ================= */
  applyLang();
  render();
  const params = new URLSearchParams(location.search);
  if (params.has('add') || (ui.autoAdd && data.entries.length > 0)) openEntry();
  document.addEventListener('visibilitychange', () => { if (scanJob && document.visibilityState === 'visible') scanJob.last = scanJob.tWait = Date.now(); });
  window.__kakeibo = { get data() { return data; }, ui, render, version: APP_VERSION, backupJSON, scanLimits: SCAN_LIMITS };
})();
