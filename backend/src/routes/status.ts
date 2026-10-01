import type { FastifyInstance } from 'fastify'
import type { StatusService } from '@/services/status'

/**
 * ТЗ v6.3 · 02, 04: статус сервиса.
 *   GET /api/status          текущий статус (для Mini App и страницы статуса)
 *   GET /api/status/history  последние 20 инцидентов
 *   GET /status              публичная страница (домен status.lynk.io проксируется сюда)
 */
export function registerStatusRoutes(app: FastifyInstance, status: StatusService) {
  let cache: { at: number; body: unknown } | null = null

  app.get('/api/status', async (_request, reply) => {
    // Кэш 15 секунд, но новый или закрытый инцидент виден сразу.
    if (!cache || Date.now() - cache.at > 15_000 || cache.at < status.changedAt()) cache = { at: Date.now(), body: await status.snapshot() }
    reply.header('cache-control', 'public, max-age=15')
    return cache.body
  })

  app.get('/api/status/history', async () => ({ incidents: await status.history(20) }))

  app.get('/status', async (_request, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8')
    reply.header('cache-control', 'no-cache')
    return reply.send(STATUS_PAGE)
  })
}

const STATUS_PAGE = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LYNK · Статус сервиса</title>
<meta name="theme-color" content="#050505">
<style>
:root{--bg:#050505;--fg:#e8e8ec;--dim:#9a9aa4;--faint:#6a6a74;--line:rgba(255,255,255,.08);--ok:#6ee7a0;--warn:#fcd34d;--bad:#fca5a5}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,BlinkMacSystemFont,Inter,'Segoe UI',sans-serif;min-height:100vh}
body:before{content:'';position:fixed;top:-300px;left:50%;transform:translateX(-50%);width:1200px;height:1000px;background:radial-gradient(circle,rgba(220,220,235,.07),transparent 60%);pointer-events:none}
main{position:relative;max-width:760px;margin:0 auto;padding:48px 16px 64px}
.brand{letter-spacing:.5em;font-size:13px;font-weight:600;text-transform:uppercase;background:linear-gradient(180deg,#fff,#a8a8b4);-webkit-background-clip:text;background-clip:text;color:transparent;text-align:center}
h1{font-size:30px;text-align:center;margin:10px 0 24px;letter-spacing:-.02em}
.card{background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.02));border:1px solid var(--line);border-radius:18px;padding:20px;margin-bottom:14px}
.hero{display:flex;align-items:center;gap:14px}
.dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;box-shadow:0 0 12px currentColor}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
.hero b{font-size:19px}.sub{color:var(--dim);font-size:13px}
.node{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}
.node:last-child{border-bottom:0}.node .name{font-weight:600}
.pill{font-size:12px;padding:3px 10px;border-radius:99px;border:1px solid currentColor;white-space:nowrap}
.bars{display:flex;gap:2px;margin-top:8px;height:22px;align-items:flex-end}
.bars i{flex:1;border-radius:2px;background:rgba(255,255,255,.08);height:100%}
.bars i.g{background:rgba(110,231,160,.7)}.bars i.y{background:rgba(252,211,77,.8)}.bars i.r{background:rgba(252,165,165,.85)}
.label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint);font-weight:600;margin:26px 4px 10px}
.inc{padding:12px 0;border-bottom:1px solid var(--line)}.inc:last-child{border-bottom:0}
.inc .t{font-weight:600}.muted{color:var(--faint);font-size:12.5px}
footer{text-align:center;color:var(--faint);font-size:12px;margin-top:32px}
</style></head><body><main>
<div class="brand">LYNK</div><h1>Статус сервиса</h1>
<div class="card hero" id="hero"><span class="dot"></span><div><b>Загружаем…</b><div class="sub">&nbsp;</div></div></div>
<div class="label">Серверы · uptime за 30 дней</div><div class="card" id="nodes"></div>
<div class="label">Последние инциденты</div><div class="card" id="incidents"></div>
<footer>Обновляется каждые 60 секунд · <span id="upd"></span></footer>
</main><script>
var C={fi:'Финляндия',nl:'Нидерланды',de:'Германия',us:'США',ru:'Россия',se:'Швеция',pl:'Польша',gb:'Великобритания',tr:'Турция',kz:'Казахстан',jp:'Япония'};
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return'&#'+c.charCodeAt(0)+';'})}
function t(d){return new Date(d).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
function flag(c){return c&&c.length==2?String.fromCodePoint.apply(null,c.toUpperCase().split('').map(function(x){return 127397+x.charCodeAt(0)})):''}
function load(){fetch('api/status').then(function(r){return r.json()}).then(function(s){
var m={ok:['ok','Все системы работают'],degraded:['warn','Есть проблемы'],down:['bad','Сбой']}[s.overall]||['warn','Нет данных'];
var sub=s.eta?'Ожидаемое восстановление: '+t(s.eta):s.openIncidents.length?s.openIncidents[0].title:'Серверов: '+s.nodes.length;
document.getElementById('hero').innerHTML='<span class="dot '+m[0]+'" style="background:currentColor"></span><div><b class="'+m[0]+'">'+m[1]+'</b><div class="sub">'+e(sub)+'</div></div>';
document.getElementById('nodes').innerHTML=s.nodes.length?s.nodes.map(function(n){
var bars=n.hourly.map(function(h){return'<i class="'+(h==null?'':h>=99?'g':h>=90?'y':'r')+'" title="'+(h==null?'нет данных':h+'%')+'"></i>'}).join('');
return'<div class="node" style="display:block"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span class="name">'+flag(n.country)+' '+e(C[n.country]||n.id)+'</span><span class="pill '+(n.online?'ok':'bad')+'">'+(n.online?(n.pingMs!=null?n.pingMs+' мс':'работает'):'недоступен')+'</span></div><div class="muted">uptime 30 дн: '+(n.uptime30d==null?'—':n.uptime30d+'%')+' · 24 ч: '+(n.uptime24h==null?'—':n.uptime24h+'%')+'</div><div class="bars">'+bars+'</div></div>'}).join(''):'<div class="muted">Серверы не настроены</div>';
document.getElementById('incidents').innerHTML=s.incidents.length?s.incidents.map(function(i){
return'<div class="inc"><div class="t '+(i.status=='open'?(i.severity=='major'?'bad':'warn'):'')+'">'+e(i.title)+'</div>'+(i.text?'<div class="sub">'+e(i.text)+'</div>':'')+'<div class="muted">'+t(i.startedAt)+(i.resolvedAt?' — решено '+t(i.resolvedAt):' — продолжается')+(i.eta&&i.status=='open'?' · восстановим к '+t(i.eta):'')+'</div></div>'}).join(''):'<div class="muted">Инцидентов не было</div>';
document.getElementById('upd').textContent='обновлено '+t(s.updatedAt)}).catch(function(){})}
load();setInterval(load,60000);
</script></body></html>`
