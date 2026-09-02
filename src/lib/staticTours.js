export const STATIC_TOURS = [
  {
    id: 'nanyue-hengshan',
    file: '/data/henshan.json',
    title: '剑出衡山 · 南岳巡礼',
    subtitle: '跟着赵荣的脚步，登五神峰寻剑神之路',
    theme: { primaryColor: '#c0392b' },
    destination: { name: '南岳衡山', region: '湖南省衡阳市' },
    stats: { locations: 21, routes: 5 },
  },
  {
    id: 'huashan-xiaoao',
    file: '/data/huashan.json',
    title: '笑傲江湖 · 华山巡礼',
    subtitle: '跟着令狐冲，上思过崖寻独孤九剑',
    theme: { primaryColor: '#c0392b' },
    destination: { name: '华山', region: '陕西省华阴市' },
    stats: { locations: 19, routes: 3 },
  },
];

export const STATIC_DATA = Object.fromEntries(
  STATIC_TOURS.map(tour => [tour.id, tour.file])
);
