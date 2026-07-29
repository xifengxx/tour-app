// Use Supabase REST API (not SQL) to avoid escaping issues with Chinese text
const URL = "https://qxunedraoviaonjdanag.supabase.co";
const KEY = "sb_publishable_Pp21-3ssB3rSxwFnA-WZZw_eUHmF31E"; // anon key
const TOUR = "73e455ab-6b29-4a02-9a93-ec96b67e5b65";
const H = { "apikey": KEY, "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" };

async function del(table) {
  // Delete existing records by tour_id using REST
  const res = await fetch(`${URL}/rest/v1/${table}?tour_id=eq.${TOUR}`, { method: "DELETE", headers: H });
  console.log(`  Deleted from ${table}:`, res.status);
}

async function insert(table, rows) {
  const res = await fetch(`${URL}/rest/v1/${table}`, { method: "POST", headers: { ...H, "Prefer": "return=representation" }, body: JSON.stringify(rows) });
  const text = await res.text();
  if (!res.ok) { console.error(`  ❌ ${table}:`, res.status, text.substring(0, 200)); return false; }
  console.log(`  ✅ ${table}: ${rows.length} rows`);
  return true;
}

const locations = [
  { id: "dai-miao", tour_id: TOUR, name: "岱庙", lat: 36.194025, lng: 117.131309, elevation: "150m", importance: 5, tags: ["封禅起点", "东方三大殿", "秦刻石", "汉柏"], sort_order: 0,
    layers: {
      pilgrimage: { text: "岱庙是历代帝王封禅泰山的起点。秦始皇东巡至此时，率文武百官在此斋戒沐浴，准备登山祭天。岱庙的主体建筑天贶殿与北京故宫太和殿、曲阜孔庙大成殿并称「东方三大神殿」。庙中的汉柏为汉武帝亲植，秦刻石残片是李斯小篆真迹——这些都是封禅大典留下的千年见证。" },
      emperors: { text: "秦始皇于公元前219年抵达岱庙，在此斋戒三日后才开始登山封禅。汉武帝刘彻先后八次登泰山，每次都要在岱庙举行隆重的告祭仪式。唐玄宗李隆基于725年封禅时，在岱庙留下《纪泰山铭》摩崖石刻。宋真宗赵恒是最后一位在泰山封禅的皇帝。" },
      folklore: { text: "传说岱庙建成时，玉皇大帝派了一只神龟来守护。神龟趴在庙门前，背上的纹路天然形成了河图洛书的图案。道士们说，这只神龟背上刻着泰山所有神仙的名字——所以进庙前要摸摸龟背，等于给诸位神仙打了招呼。" },
      qilu: { text: "岱庙不仅是一座庙宇，更是齐鲁文化的殿堂。庙内碑碣林立，现存历代碑刻300余方，从李斯小篆到乾隆御笔，堪称「中国书法博物馆」。天贶殿内的宋代壁画《泰山神启跸回銮图》长达62米。" }
    },
    reflection: "两千多年前秦始皇从这里出发登山，两千多年后你站在同一个地方。天地没变，山也没变——变的是什么？",
    practical: { access: "泰安市区步行可达", difficulty: "轻松", tip: "建议登山前来此参观1-2小时，天贶殿壁画不可错过" }
  },
  { id: "hong-men", tour_id: TOUR, name: "红门", lat: 36.210740, lng: 117.127987, elevation: "250m", importance: 4, tags: ["登山起点", "红门宫", "传统路线"], sort_order: 1,
    layers: {
      pilgrimage: { text: "红门是泰山中路登山的真正起点。古代帝王在岱庙斋戒后，乘辇至红门，在此换乘肩舆开始登山。红门宫前的三重石坊——一天门坊、孔子登临处坊、天阶坊——形成庄严的登山序幕。从红门到玉皇顶，全程9.5公里，6600余级台阶，正是秦始皇当年踏过的封禅之路。" },
      emperors: { text: "秦始皇在红门弃车换辇，3万随行队伍只挑选了72名精锐随同登顶。乾隆皇帝11次登泰山，每次都在红门宫小憩饮茶，留下多首纪游诗。他在红门题「初步登高」四字，意为登山之路从此开始。" },
      folklore: { text: "红门为什么是红色的？传说泰山上有一只恶虎常年吃人，一位红衣女子手持宝剑与虎搏斗三天三夜，最终将恶虎斩杀。女子流出的血染红了山门——从此这里就叫红门。" },
      qilu: { text: "红门是泰山儒释道三教交汇的起点。红门宫本身是道教宫观，旁边的孔子登临处坊纪念了孔子登泰山的事迹——《孟子》载「孔子登东山而小鲁，登泰山而小天下」。" }
    },
    reflection: "乾隆11次登泰山，你第几次？不用和皇帝比次数——想一想，你为什么来登山？",
    practical: { access: "泰山站乘3路公交至红门站", difficulty: "轻松", tip: "登山前可在红门附近购买登山杖和水" }
  },
  { id: "jing-shi-yu", tour_id: TOUR, name: "经石峪", lat: 36.224815, lng: 117.123978, elevation: "600m", importance: 3, tags: ["北齐刻经", "大字鼻祖", "佛教文化"], sort_order: 2,
    layers: {
      pilgrimage: { text: "经石峪是封禅路线上的重要侧景点。在一片约3000平方米的天然石坪上，刻有北齐时期的《金刚般若波罗密经》全文，现存1043字，字径半米——这是中国现存规模最大的摩崖刻经。" },
      emperors: { text: "唐高宗和武则天封禅时，曾专门绕道经石峪观摩刻经。乾隆皇帝三次来此题诗留念——他评价经石峪刻经为「榜书之宗、大字鼻祖」。" },
      folklore: { text: "传说北齐时，一位无名僧人在此修行，每日用扫帚蘸水在石坪上写《金刚经》。居士感动出资请石匠刻入石坪。据说月圆之夜，刻经会发出淡淡的金光。" },
      qilu: { text: "经石峪是泰山佛教文化的巅峰之作。刻经字体介于隶书与楷书之间，被称为「经石峪体」，是中国书法史上承前启后的重要字体。" }
    },
    reflection: "一个字半米大——那位无名僧人为什么要写这么大的字？",
    practical: { access: "红门登山约40分钟有岔路", difficulty: "轻松", tip: "往返约15分钟值得绕道" }
  },
  { id: "wu-daifu-song", tour_id: TOUR, name: "五大夫松", lat: 36.246571, lng: 117.112902, elevation: "920m", importance: 3, tags: ["秦始皇封松", "秦代遗事"], sort_order: 3,
    layers: {
      pilgrimage: { text: "据《史记》记载：秦始皇登泰山途中遇暴雨，在一棵大松树下避雨，因松树「护驾有功」，封其为「五大夫」——秦代二十等爵位中的第九等。原树在明代被山洪冲毁，现存两棵古松为清代补植。" },
      emperors: { text: "秦始皇向来以铁腕著称——焚书坑儒、修筑长城——却为一棵松树加官进爵，这是帝王与自然之间罕见的温情互动。明万历年间发大水冲毁秦松，万历帝下旨补种。" },
      folklore: { text: "当地传说：秦始皇在树下躲雨时，是一位山村女子用松枝编成伞盖为他遮雨。始皇帝要封她为妃，女子婉拒：我宁愿做一棵松树，给每个登山的人遮风挡雨。" },
      qilu: { text: "秦代实行二十等爵制，「五大夫」是第九等。封一棵树为五大夫，体现了秦始皇的幽默感，也反映了秦人「万物有灵」的信仰。五大夫松旁的云步桥是最美休息点。" }
    },
    reflection: "秦始皇封一棵松树为「五大夫」——统一六国的千古一帝，对着一棵树下拜加封。",
    practical: { access: "中天门上行约20分钟", difficulty: "轻松", tip: "云步桥是拍照最佳点" }
  },
  { id: "zhong-tian-men", tour_id: TOUR, name: "中天门", lat: 36.239086, lng: 117.114472, elevation: "847m", importance: 4, tags: ["登山中转", "索道起点", "半程标志"], sort_order: 4,
    layers: {
      pilgrimage: { text: "中天门是封禅之路的「半程驿站」。古代帝王到达此处时已是午后——从红门登至此地需要约3小时。随行队伍在此扎营休整、生火做饭。从中天门仰望，南天门已隐约可见于云雾之间。" },
      emperors: { text: "汉武帝封禅时在中天门停留了两天——他觉得此处「灵气充沛」，决定在此增建行宫。唐玄宗到达时感叹「一步分天地」。清末光绪年间在此修建了第一条索道。" },
      folklore: { text: "传说中天门是天庭的「传达室」。登泰山的人到了这里才算正式进入了神仙地界。当地人保留着一个习俗：过中天门时要往路边石堆上添一块石头，这叫「添石添寿」。" },
      qilu: { text: "中天门是泰山「天地分界」的文化象征。中天门以下为「人间」，以上为「天界」。附近的「斩云剑」是一座天然石峰——传说它能把云海从中劈开。" }
    },
    reflection: "站在中天门，往上看是天界，往下看是人间。你此刻在哪一边？",
    practical: { access: "红门步行约3小时或天外村乘车30分钟", difficulty: "中等", tip: "此处可乘索道直达南天门" }
  },
  { id: "shiba-pan", tour_id: TOUR, name: "十八盘", lat: 36.251039, lng: 117.107992, elevation: "1200m", importance: 5, tags: ["最险段", "1600级台阶", "升仙坊"], sort_order: 5,
    layers: {
      pilgrimage: { text: "十八盘是封禅之路的终极考验。全长800米、落差400米、1600余级台阶——这是泰山最陡峭的一段。古代帝王到此也必须下轿步行，以示对天地的诚心。秦始皇攀登时，72名随从近半数掉队——但始皇本人坚持走完了全程。" },
      emperors: { text: "汉武帝在十八盘上把随行大臣甩在身后，独自冲到最前面，站在升仙坊下大喊：「朕乃天子，此乃天梯！」唐玄宗咬牙拒绝乘轿，硬是爬完全程。宋真宗登山前特意练了三个月体力。" },
      folklore: { text: "泰山神有十八个儿子，每个负责一「盘」山路。小儿子的那盘最陡——因为他最受宠，神力最大，故意把路修得最险。所以十八盘的「紧十八」在最上面，最陡最窄。" },
      qilu: { text: "十八盘最早的台阶凿于东汉。升仙坊是分界点——通过十八盘，就等于走完了凡人到神仙的距离。每年泰山国际登山节的决胜赛段就在十八盘。" }
    },
    reflection: "1600级台阶，历代帝王自己走完的。你走上十八盘的时候，前面是古人两千年的足迹，后面是你自己的脚印。",
    practical: { access: "中天门上行约1.5小时", difficulty: "困难", tip: "走Z字形省力，扶铁链可借力" }
  },
  { id: "nan-tian-men", tour_id: TOUR, name: "南天门", lat: 36.255801, lng: 117.104329, elevation: "1460m", importance: 5, tags: ["泰山标志", "天界入口", "元代建筑"], sort_order: 6,
    layers: {
      pilgrimage: { text: "穿过十八盘最后一级台阶，抬头便是南天门。朱红色的大门镶嵌在蓝天白云之间，仿佛真的通向了天宫。进入南天门，意味着你已踏入「天界」。古代帝王在此整冠肃容、焚香祷告，准备走向最后的祭天之所——玉皇顶。" },
      emperors: { text: "南天门始建于元中统五年（1264年）。唐玄宗在此引用杜甫《望岳》「岱宗夫如何？齐鲁青未了」。乾隆题「望吴圣迹」。历代帝王在此驻足的时间往往比玉皇顶还长——因为这里最美。" },
      folklore: { text: "传说南天门是二郎神杨戬奉玉帝之命建造的。他于心不忍登山者的辛苦，在门后变出了一条天街让人歇脚。每年农历六月二十四（二郎神诞辰），南天门前香火格外旺盛。" },
      qilu: { text: "南天门是泰山「天地人三界合一」的集中体现。门内是「天界」，门外是「人间」。对联「门辟九霄仰步三天胜迹，阶崇万级俯临千嶂奇观」完美诠释了天地交融的意境。" }
    },
    reflection: "跨过这道门，你就进了天界。可你明明还在泰山上——天界到底存在吗？它在门后面，还是在你的心里？",
    practical: { access: "十八盘顶端", difficulty: "中等", tip: "经典拍照点，人流量大建议早到" }
  },
  { id: "tian-jie", tour_id: TOUR, name: "天街", lat: 36.256052, lng: 117.104801, elevation: "1480m", importance: 4, tags: ["山顶集市", "住宿餐饮"], sort_order: 7,
    layers: {
      pilgrimage: { text: "天街是南天门后一段长约一公里的山顶平路，两侧遍布客栈、商铺、道观。封禅大典前后，帝王随从队伍在此驻扎。如今的「天街」已发展为一个功能齐备的山顶小镇——宾馆、餐厅、纪念品店一应俱全。" },
      emperors: { text: "宋真宗封禅时在天街大摆宴席，宴席摆在露天天街上，云雾从脚下飘过。乾隆在天街喝过茶，他说「天上的茶就是比地上的香」——其实是高山沸点低，泡出来的茶别有风味。" },
      folklore: { text: "天街是二郎神变的。他看登山者又累又饿，用三尖两刃刀在石壁上一划变出了一条街。二郎神设了规矩：天街上所有东西的价格都不能太贵，因为「天上的神仙不贪财」。" },
      qilu: { text: "天街是泰山「庙会文化」在山顶的延伸。每年三月三「蟠桃会」和三月十五「泰山奶奶诞辰」，天街变成巨大的庙会现场——山顶上搭戏台唱大戏、舞泰山皮影。" }
    },
    reflection: "在1500米的山顶上有一条街——和山下的街有什么不同？是街不同，还是你不同？",
    practical: { access: "南天门步行5分钟", difficulty: "轻松", tip: "宾馆需提前预订" }
  },
  { id: "bixia-ci", tour_id: TOUR, name: "碧霞祠", lat: 36.255714, lng: 117.109385, elevation: "1500m", importance: 4, tags: ["泰山奶奶", "宋真宗敕建", "千年道观"], sort_order: 8,
    layers: {
      pilgrimage: { text: "碧霞祠是泰山规模最大的高山古建筑群，供奉着道教女神碧霞元君——民间更亲切地称她为「泰山奶奶」。宋真宗赵恒封禅后为还愿敕建。大殿铁瓦覆顶以防山顶狂风——工匠们在海拔1500米的高山上完成这一切，堪称建筑奇迹。" },
      emperors: { text: "宋真宗登山途中迷路，白发老妪为他指路后化作青烟消失。真宗认定此乃泰山女神显灵，遂下旨修建碧霞祠。明清皇帝虽不再封禅，但到泰山必定来此上香。慈禧太后派太监专程来此进香祈福超过十次。" },
      folklore: { text: "泰山奶奶是山东乃至华北最受敬仰的民间神祇。传说她原是泰安城里一个普通孝女，后在泰山修行得道成仙。她特别怜悯老百姓的疾苦——求子、求医、求平安，有求必应。每年农历三月十五几十万香客登山来拜。" },
      qilu: { text: "「泰山奶奶」信仰圈涵盖山东、河北、河南三省。每到诞辰各地信众组成「香社」徒步来朝拜。大殿铁瓦360片象征一年360天都有庇佑。院内铜钟铸于明万历年间，钟声一响能传到山下泰安城。" }
    },
    reflection: "泰山奶奶管送子、治病、保平安、牵红线——为什么一个道教女神比很多皇帝还受百姓爱戴？",
    practical: { access: "天街步行10分钟", difficulty: "轻松", tip: "求姻缘者必拜，同心锁可在天街购买" }
  },
  { id: "yuhuang-ding", tour_id: TOUR, name: "玉皇顶", lat: 36.257337, lng: 117.109129, elevation: "1545m", importance: 5, tags: ["泰山极顶", "祭天圣地", "五岳独尊"], sort_order: 9,
    layers: {
      pilgrimage: { text: "玉皇顶——泰山之巅，海拔1545米。这是封禅之路的终点，历代帝王在此「燔柴祭天」：筑起柴坛，点燃大火，青烟直升天际，帝王面向苍穹跪拜，向昊天上帝报告治国功绩。玉皇殿上匾额「柴望遗风」正是记载了这上古祭天仪式。" },
      emperors: { text: "秦始皇在玉皇顶完成了中国历史上第一次有记载的帝王封禅。汉武帝八次登临此处。唐高宗与武则天携手同行登顶——唯一一对同时封禅的皇帝与皇后。武则天登顶后激动落泪：「妾身何等荣幸，能与陛下共沐天恩！」" },
      folklore: { text: "玉皇大帝曾在此召集天下山神开会——泰山神是会议主持，五岳之中泰山为首。各路山神来的时候各显神通：峨眉山神骑着白象，华山神踩着云朵。开完后玉帝留下一枚玉印——就是「五岳独尊」那块巨石。" },
      qilu: { text: "泰山之所以为五岳之首，不仅因为它是「东岳」——太阳升起的方向，阴阳五行中属「生」，是最尊贵的方位。自周代起，泰山就被视为「天帝之居、人神交汇」之所。「登泰山而小天下」——孔子这句话定义了泰山在中国文化中的不可撼动之位。" }
    },
    reflection: "你站在1545米，秦始皇也站在这里。两千三百年过去了——山顶的石头没变，天空没变，但你和他看到的风景一样吗？",
    practical: { access: "天街步行15分钟", difficulty: "平缓", tip: "日出前30分钟来占位" }
  },
  { id: "riguan-peak", tour_id: TOUR, name: "日观峰", lat: 36.256668, lng: 117.110565, elevation: "1530m", importance: 4, tags: ["泰山日出", "拱北石", "四大奇观"], sort_order: 10,
    layers: {
      pilgrimage: { text: "日观峰是泰山观日出的最佳地点。封禅大典通常在黎明举行——帝王先在此迎接日出，然后移步玉皇顶祭天。「旭日东升」是泰山四大奇观之首：太阳从云海中跳出，金色光芒瞬间染红天际——那种壮美让人瞬间理解古人为什么要在泰山之巅祭天。" },
      emperors: { text: "汉武帝在日观峰看过一次日出后入了迷。他八次登泰山，至少五次冲着日出来。有一次等了三个早晨——前两天雨、一天多云。日出出来的那一刻，一国之君激动得手舞足蹈：「天之光、天之光！」" },
      folklore: { text: "拱北石也叫「探海石」——传说它是女娲补天时用来搅天河的勺子。女娲扔在日观峰上变成了石头。因为勺子是补天神器，所以天生能感知太阳动静——每天黎明微微颤动，然后太阳就出来了。" },
      qilu: { text: "在齐鲁传统文化中，「泰山观日」象征着「近天光、得先机」。古代科举考生常在考前登山观日出，求「旭日东升、前途光明」。如今每年元旦成千上万人通宵爬山只为在日观峰迎接新年第一缕阳光。" }
    },
    reflection: "你凌晨四点起床等日出——汉武帝也等过。日出值不值得等四个小时？不，它值不值得等两千年？",
    practical: { access: "玉皇顶东侧步行5分钟", difficulty: "轻松", tip: "看日出需凌晨4点前到达，山顶租军大衣30元/件" }
  },
];

const routes = [
  { id: "route-fengshan-full", tour_id: TOUR, day_label: "封禅2日", title: "帝王封禅全程（红门·全程徒步）",
    stops: ["dai-miao","hong-men","jing-shi-yu","wu-daifu-song","zhong-tian-men","shiba-pan","nan-tian-men","tian-jie","bixia-ci","yuhuang-ding","riguan-peak"],
    narrative: "追随秦始皇足迹的完整封禅路线。Day1岱庙出发→红门→经石峪→五大夫松→中天门→十八盘→南天门→夜宿天街。Day2凌晨日观峰看日出→碧霞祠→玉皇顶登极。全程26公里，重现两千年封禅之路。", sort_order: 0 },
  { id: "route-shortcut-1day", tour_id: TOUR, day_label: "快捷1日", title: "索道快线（中天门上·南天门下）",
    stops: ["dai-miao","zhong-tian-men","shiba-pan","nan-tian-men","tian-jie","bixia-ci","yuhuang-ding","riguan-peak"],
    narrative: "适合时间有限。岱庙参观后乘旅游车至中天门→挑战精华段十八盘→南天门→天街→碧霞祠→玉皇顶→日观峰→索道下山。全程约6小时。", sort_order: 1 },
  { id: "route-night-1day", tour_id: TOUR, day_label: "夜登1日", title: "夜登泰山看日出",
    stops: ["hong-men","zhong-tian-men","shiba-pan","nan-tian-men","riguan-peak","yuhuang-ding","bixia-ci","tian-jie"],
    narrative: "泰山经典玩法。晚上11点红门出发→凌晨3点到南天门→4点日观峰等日出→玉皇顶→碧霞祠→天街早餐→下山。夜登泰山是每个山东大学生的成人礼。", sort_order: 2 },
];

async function main() {
  console.log("🗑 清除旧数据...");
  await del("locations");
  await del("routes");

  console.log("\n📍 写入地点...");
  await insert("locations", locations);

  console.log("\n🗺 写入路线...");
  await insert("routes", routes);

  console.log("\n🎉 完成！");
}
main().catch(e => console.error(e.message));
