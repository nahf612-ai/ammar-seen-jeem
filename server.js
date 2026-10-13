import express from 'express';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import {randomInt, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
const app=express(); const server=createServer(app); const io=new Server(server,{maxHttpBufferSize:10000});
const bank=JSON.parse(readFileSync(new URL('./questions.json',import.meta.url),'utf8'));
const cats=[...new Set(bank.map(q=>q.category))]; const rooms=new Map();
app.use(express.static('public'));
const safe=s=>String(s??'').trim().slice(0,32);
const reply=(cb,data)=>{if(typeof cb==='function')cb(data)};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){let j=randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}return a};
function roomOf(s){const r=rooms.get(s.data.code);return r&&r.members.get(s.id)===s.data.role?r:null}
function view(r,s){const host=r.host===s.id;const q=r.current;return {code:r.code,role:s.data.role,teams:r.teams,scores:r.scores,categories:r.categories,allCategories:host?cats:undefined,used:r.used,turn:r.turn,round:r.round,question:q?{text:q.text,options:q.options,category:q.category,points:q.points,cell:q.cell,answer:host||r.revealed?q.answer:null}:null,revealed:r.revealed,awarded:r.awarded,finished:r.finished,hostOnline:!!r.host,connected:[...r.members.values()].reduce((a,v)=>(a[v]=(a[v]||0)+1,a),{})}}
function broadcast(r){for(const id of r.members.keys()){const s=io.sockets.sockets.get(id);if(s)s.emit('state',view(r,s))}}
function closeRoom(r){io.to(r.code).emit('closed');rooms.delete(r.code)}
io.on('connection',s=>{
 s.on('create',(data,cb)=>{if(s.data.code)return reply(cb,{error:'أنت داخل غرفة بالفعل'});let code;do{code=String(randomInt(100000,1000000))}while(rooms.has(code));let categories=shuffle([...cats]).slice(0,6);const r={code,host:s.id,teams:[safe(data?.red)||'الصقور',safe(data?.blue)||'الملوك'],scores:[0,0],categories,used:[],turn:0,round:0,current:null,revealed:false,awarded:false,finished:false,members:new Map([[s.id,'host']])};rooms.set(code,r);s.join(code);s.data={code,role:'host'};reply(cb,{ok:true,code,role:'host'});broadcast(r)});
 s.on('join',(data,cb)=>{const code=String(data?.code||'').trim();const r=rooms.get(code);if(!r)return reply(cb,{error:'الغرفة غير موجودة'});if(s.data.code)return reply(cb,{error:'أنت داخل غرفة بالفعل'});const role=data?.role;if(!['red','blue','viewer'].includes(role))return reply(cb,{error:'دور غير صحيح'});if((role==='red'||role==='blue')&&[...r.members.values()].includes(role))return reply(cb,{error:'هذا الفريق محجوز بالفعل'});s.join(code);s.data={code,role};r.members.set(s.id,role);if(role==='red'&&safe(data.name))r.teams[0]=safe(data.name);if(role==='blue'&&safe(data.name))r.teams[1]=safe(data.name);reply(cb,{ok:true,code,role});broadcast(r)});
 s.on('categories',(data,cb)=>{const r=roomOf(s);if(!r||r.host!==s.id)return reply(cb,{error:'للمقدم فقط'});if(r.round)return reply(cb,{error:'لا يمكن تغيير الفئات بعد بداية اللعب'});const selected=data?.categories;if(!Array.isArray(selected)||selected.length!==6||new Set(selected).size!==6||selected.some(c=>!cats.includes(c)))return reply(cb,{error:'اختر ست فئات مختلفة'});r.categories=selected;reply(cb,{ok:true});broadcast(r)});
 s.on('pick',(data,cb)=>{const r=roomOf(s);if(!r||r.host!==s.id)return reply(cb,{error:'للمقدم فقط'});if(r.finished||r.current&&!r.awarded)return reply(cb,{error:'أنهِ السؤال الحالي أولاً'});const col=Number(data?.col),row=Number(data?.row);if(!Number.isInteger(col)||col<0||col>5||!Number.isInteger(row)||row<0||row>2)return reply(cb,{error:'اختيار غير صحيح'});const cell=`${col}:${row}`;if(r.used.includes(cell))return reply(cb,{error:'المربع مستخدم'});const category=r.categories[col],level=['easy','medium','hard'][row];let pool=bank.filter(q=>q.category===category&&q.level===level&&!r.usedQuestions?.has(q.text));if(!pool.length)pool=bank.filter(q=>q.category===category&&!r.usedQuestions?.has(q.text));if(!pool.length)return reply(cb,{error:'لا توجد أسئلة في الفئة'});const picked=pool[randomInt(pool.length)];r.usedQuestions??=new Set();r.usedQuestions.add(picked.text);r.current={...picked,options:shuffle([...picked.options]),points:[200,400,600][row],cell};r.used.push(cell);r.round++;r.revealed=false;r.awarded=false;reply(cb,{ok:true});broadcast(r)});
 s.on('reveal',(_,cb)=>{const r=roomOf(s);if(!r||r.host!==s.id||!r.current)return reply(cb,{error:'غير مسموح'});r.revealed=true;reply(cb,{ok:true});broadcast(r)});
 s.on('award',(data,cb)=>{const r=roomOf(s);if(!r||r.host!==s.id||!r.current||r.awarded)return reply(cb,{error:'لا يمكن احتساب هذا السؤال'});const team=data?.team;if(team!==null&&team!==0&&team!==1)return reply(cb,{error:'الفريق غير صحيح'});if(team!==null)r.scores[team]+=r.current.points;r.awarded=true;r.turn=1-r.turn;if(r.used.length===18)r.finished=true;reply(cb,{ok:true});broadcast(r)});
 s.on('reset',(_,cb)=>{const r=roomOf(s);if(!r||r.host!==s.id)return reply(cb,{error:'للمقدم فقط'});Object.assign(r,{scores:[0,0],used:[],usedQuestions:new Set(),turn:0,round:0,current:null,revealed:false,awarded:false,finished:false});reply(cb,{ok:true});broadcast(r)});
 s.on('disconnect',()=>{const r=roomOf(s);if(!r)return;r.members.delete(s.id);if(r.host===s.id)closeRoom(r);else broadcast(r)})
});
server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('عمار سين جيم يعمل على المنفذ '+(process.env.PORT||3000)));
