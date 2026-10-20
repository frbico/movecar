import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const source=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../request-ui.js'),'utf8');

class Node {
  constructor(tag='div',text=''){
    this.tagName=tag.toLowerCase();this._text=text;this.children=[];this.parentNode=null;
    this.attributes=new Map();this.style={};this.disabled=false;this.hidden=false;
    this.handlers={};this.className='';this.id='';this.innerHTML=text;
    this.classList={add:()=>{},remove:()=>{}};
  }
  get textContent(){return this._text||this.children.map(c=>c.textContent).join('');}
  set textContent(s){this._text=String(s);this.children=[];}
  appendChild(node){node.remove();node.parentNode=this;this.children.push(node);return node;}
  insertBefore(node,ref){node.remove();const at=this.children.indexOf(ref);node.parentNode=this;this.children.splice(at<0?this.children.length:at,0,node);return node;}
  insertAdjacentElement(where,node){if(!this.parentNode)return;const at=this.parentNode.children.indexOf(this);this.parentNode.insertBefore(node,this.parentNode.children[at+(where==='afterend'?1:0)]||null);}
  remove(){if(this.parentNode){const arr=this.parentNode.children;const i=arr.indexOf(this);if(i>=0)arr.splice(i,1);this.parentNode=null;}}
  contains(node){return node===this||this.children.some(c=>c.contains(node));}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  getAttribute(k){return this.attributes.get(k)||null;}
  removeAttribute(k){this.attributes.delete(k);}
  addEventListener(t,fn){this.handlers[t]=fn;}
  querySelectorAll(selector){const tags=selector.split(',');const output=[];const visit=n=>{for(const c of n.children){if(tags.includes(c.tagName))output.push(c);visit(c);}};visit(this);return output;}
  querySelector(selector){
    const visit=n=>{for(const c of n.children){if(selector.startsWith('#')&&c.id===selector.slice(1))return c;
      if(selector.startsWith('.')&&c.className.split(' ').includes(selector.slice(1)))return c;
      if(c.tagName===selector)return c;const nested=visit(c);if(nested)return nested;}return null;};
    return visit(this);
  }
}
function build({existingVoice=false}={}){
  const body=new Node('body'),main=new Node('div'),success=new Node('div');
  main.id='mainView';success.id='successView';
  body.appendChild(main);body.appendChild(success);
  const notify=new Node('button','一键通知车主');notify.id='notifyBtn';main.appendChild(notify);
  const voice=existingVoice?new Node('button','网络语音呼叫车主'):null;
  if(voice)main.appendChild(voice);
  const audio=new Node('button','音频输出设置');main.appendChild(audio);
  const successCard=new Node('section');successCard.className='success-card';
  const waiting=new Node('p','正在等待');waiting.id='waitingText';successCard.appendChild(waiting);
  const feedback=new Node('section');feedback.id='ownerFeedback';feedback.appendChild(new Node('p','正在赶来'));
  const actions=new Node('section');actions.className='action-card';
  const hint=new Node('p','车主没反应？');
  const retry=new Node('button','再次通知');retry.id='retryBtn';
  const phone=new Node('a','直接打电话');phone.className='btn-phone';phone.setAttribute('href','tel:123456789');
  actions.appendChild(hint);actions.appendChild(retry);actions.appendChild(phone);
  success.appendChild(successCard);success.appendChild(feedback);success.appendChild(actions);
  const nodes=[body,main,success,notify,waiting,feedback,retry,phone];
  const photo={};
  for(const id of ['photoPreview','photoChooseBtn','photoPicker','photoSendBtn','photoStatus']){photo[id]=new Node('button');photo[id].id=id;nodes.push(photo[id]);}
  const document={
    body,
    createElement:tag=>new Node(tag),
    getElementById:id=>nodes.find(n=>n.id===id)||null,
    querySelectorAll:selector=>body.querySelectorAll(selector)
  };
  let now=100000,notifyCount=0,pollCount=0;
  const intervals=[],toasts=[];
  const fetch=async url=>{
    if(url==='/api/site-config')return {ok:true,json:async()=>({wechatId:'wx_demo'})};
    if(url==='/api/notify'){
      notifyCount++;
      if(notifyCount===2)return {ok:false,status:429,headers:{get:n=>n==='Retry-After'?'44':null},json:async()=>({error:'发送过于频繁'})};
      return {ok:true,json:async()=>({success:true,requestId:'R',pollToken:'P',photoToken:'T'})};
    }
    if(url==='/api/request-status'){pollCount++;return {ok:true,json:async()=>({status:'waiting'})};}
    throw Error('Unexpected fetch '+url);
  };
  const context={document,window:{},fetch,navigator:{},Date:{now:()=>now},
    setInterval:fn=>(intervals.push(fn),intervals.length),
    clearInterval:()=>{},showToast:s=>toasts.push(s),URL:{revokeObjectURL:()=>{}},console};
  vm.runInNewContext(source,context);
  return {context,main,success,actions,phone,voice,audio,notify,retry,photo,toasts,intervals,
    setNow:n=>{now=n},getNotifyCount:()=>notifyCount};
}
function actionLabels(actions){return actions.children.filter(n=>['button','a'].includes(n.tagName)).map(n=>n.textContent);}
test('visitor contact actions stay ordered, voice is not falsely enabled, and phone waits 60 seconds',async()=>{
  const ui=build();
  assert.equal(ui.audio.parentNode,null);
  assert.equal(ui.notify.textContent,'一键通知车主');
  const names=actionLabels(ui.actions);
  assert.equal(names[0],'再次通知');
  assert.equal(names[1],'语音通话');
  assert.equal(names[2],'💬 微信联系（未配置）');
  assert.equal(names[3],'电话联系');
  assert.equal(ui.actions.children.find(n=>n.id==='voiceUnavailableBtn').disabled,true);
  assert.equal(ui.phone.getAttribute('href'),null);
  await ui.context.window.sendNotify();
  assert.equal(ui.main.style.display,'none');
  assert.equal(ui.success.style.display,'flex');
  assert.equal(ui.phone.getAttribute('href'),null);
  ui.setNow(161001);for(const callback of ui.intervals)callback();
  assert.equal(ui.phone.getAttribute('href'),'tel:123456789');
  await ui.context.window.retryNotify();
  assert.ok(ui.toasts.some(s=>s.includes('44 秒后再试')));
  assert.equal(ui.getNotifyCount(),2);
});
test('a pre-existing real voice control is moved from home to contact list without losing its handler',()=>{
  const ui=build({existingVoice:true});
  const cb=()=>{};
  ui.voice.addEventListener('click',cb);
  assert.equal(ui.voice.parentNode,ui.actions);
  assert.equal(ui.voice.textContent,'语音通话');
  assert.equal(ui.voice.handlers.click,cb);
  assert.equal(ui.audio.parentNode,null);
  assert.equal(actionLabels(ui.actions)[1],'语音通话');
  assert.equal(ui.actions.children.filter(n=>n.id==='voiceUnavailableBtn').length,0);
});
