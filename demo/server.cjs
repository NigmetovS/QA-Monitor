// Демо-магазин для показа клиентам.
// DEMO_FAULT позволяет «сломать» его вживую и показать, как приходит алерт:
//   DEMO_FAULT=checkout — оформление заказа перестаёт работать
//   DEMO_FAULT=cart     — корзина не считает товары
const http = require('node:http');

const port = Number(process.env.PORT || 4173);
const fault = process.env.DEMO_FAULT || '';

const addHandler = fault === 'cart'
  ? '()=>{}'
  : "()=>{document.querySelector('[data-testid=\"cart-count\"]').textContent=String(++n)}";
const okText = fault === 'checkout' ? 'Something went wrong' : 'Order received';

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo Shop</title>
<style>
:root{--a:#175cd3;--t:#1b2230;--m:#667085;--l:#e4e7ec}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--t);background:#f6f7f9}
header{background:#fff;border-bottom:1px solid var(--l)}header div,main{max-width:760px;margin:0 auto;padding:16px}
h1{margin:0;font-size:22px}header p{margin:0;color:var(--m);font-size:14px}
.panel{background:#fff;border:1px solid var(--l);border-radius:14px;padding:24px;margin-top:24px;display:grid;gap:8px}
.product{display:flex;gap:16px;align-items:center}.img{width:88px;height:88px;border-radius:12px;background:linear-gradient(135deg,#b2ccff,#175cd3)}
h2{margin:0;font-size:18px}.price{font-weight:700}
button,input{font:inherit;padding:10px 14px;border-radius:8px}input{border:1px solid var(--l);width:100%}
button{background:var(--a);color:#fff;border:0;cursor:pointer;justify-self:start}
label{font-weight:600;margin-top:8px}[role=alert]{color:#d92d20;min-height:1.5em}[role=status]{color:#039855;font-weight:600;min-height:1.5em}
</style></head><body>
<header><div><h1>Demo Shop</h1><p>QA Monitor demonstration storefront</p></div></header>
<main><div class="panel">
<div class="product"><div class="img"></div><div><h2>Sample product</h2><div class="price">12 990 ₸</div><div>Cart: <strong data-testid="cart-count">0</strong></div></div></div>
<button id="add">Add to cart</button><hr style="border:0;border-top:1px solid var(--l);width:100%">
<label for="email">Email</label><input id="email" type="email" placeholder="you@example.com">
<div id="error" role="alert"></div><button id="checkout">Checkout</button><p role="status"></p>
</div></main>
<script>let n=0;document.getElementById('add').onclick=${addHandler};
document.getElementById('checkout').onclick=()=>{const v=document.getElementById('email').value;
document.getElementById('error').textContent=v?'':'Email is required';
document.querySelector('[role="status"]').textContent=v?${JSON.stringify(okText)}:''}</script>
</body></html>`;

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, '127.0.0.1', () => {
  console.log(`Demo running on http://127.0.0.1:${port}${fault ? ` (DEMO_FAULT=${fault})` : ''}`);
});
