const A="Authorization";
const T="Bearer "+process.env.SUPABASE_PAT;
const U="https://api.supabase.com/v1/projects/qxunedraoviaonjdanag/database/query";
const H={"Content-Type":"application/json",[A]:T};
const Q=(q)=>fetch(U,{method:"POST",headers:H,body:JSON.stringify({query:q})}).then(r=>r.json());

async function main() {
const TOUR="1baca791-416e-4c72-8fed-3f59001369bf";

// Clean up
await Q(`DELETE FROM routes WHERE id='route-test'`);

const routes = [
  {
    id:"route-classic-2day", day:"经典2日", title:"课本经典路线（后山上·前山下）",
    stops:"{yungu-temple,shixin-peak,mengbi-shenghua,houzi-guanhai,guangming-ding,feilai-shi,xihai-canyon,yingke-song,lianhua-peak,tiandu-peak,ciguang-pavilion}",
    narr:"最经典的黄山2日游路线。Day1后山索道上→北海景区→光明顶看日落；Day2日出→西海大峡谷→迎客松→挑战天都峰鲫鱼背。涵盖课本中所有核心地点。",
    order:0
  },
  {
    id:"route-textbook-1day", day:"课本1日", title:"小学课文一日游",
    stops:"{yungu-temple,shixin-peak,houzi-guanhai,mengbi-shenghua,feilai-shi,yingke-song}",
    narr:"专为亲子家庭设计。打卡《黄山奇石》猴子观海+梦笔生花→飞来石（《红楼梦》片头）→迎客松合影。全程索道+平缓步道。",
    order:1
  },
  {
    id:"route-adventure-2day", day:"挑战2日", title:"天都莲花双峰挑战（前山上·后山下）",
    stops:"{ciguang-pavilion,tiandu-peak,yingke-song,lianhua-peak,guangming-ding,feilai-shi,xihai-canyon,shixin-peak,yungu-temple}",
    narr:"Day1慈光阁出发→挑战天都峰鲫鱼背（《爬天都峰》同款）→莲花峰登顶→光明顶日落。Day2飞来石→西海大峡谷悬空栈道→始信峰下山。",
    order:2
  },
];

for(const r of routes) {
  const narr = r.narr.replace(/'/g, "''");
  const title = r.title.replace(/'/g, "''");
  const q = `INSERT INTO routes(id,tour_id,day_label,title,stops,narrative,sort_order) VALUES('${r.id}','${TOUR}','${r.day}','${title}','${r.stops}','${narr}',${r.order})`;
  await Q(q);
  console.log("✅", r.title);
}

const cnt = await Q(`SELECT count(*) as c FROM routes WHERE tour_id='${TOUR}'`);
console.log("\n总路线数:", cnt[0].c);
}
main();
