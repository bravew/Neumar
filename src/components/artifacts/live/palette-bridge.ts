export interface PaletteBridgeApply {
  type: 'palette/apply';
  hue: number;
  sat: number;
  lightnessDelta: number;
  desaturate: boolean;
}

export interface PaletteBridgeReset {
  type: 'palette/reset';
}

export type PaletteBridgeRequest = PaletteBridgeApply | PaletteBridgeReset;

export interface PalettePreset {
  id: string;
  swatch: string;
  request: PaletteBridgeRequest;
}

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    id: 'original',
    swatch: 'linear-gradient(135deg,#111827,#f8fafc)',
    request: { type: 'palette/reset' },
  },
  {
    id: 'coral',
    swatch: 'linear-gradient(135deg,#ff6f61,#ffd1c8)',
    request: {
      type: 'palette/apply',
      hue: 8,
      sat: 105,
      lightnessDelta: 2,
      desaturate: false,
    },
  },
  {
    id: 'electric',
    swatch: 'linear-gradient(135deg,#2563eb,#7dd3fc)',
    request: {
      type: 'palette/apply',
      hue: 218,
      sat: 115,
      lightnessDelta: 0,
      desaturate: false,
    },
  },
  {
    id: 'acidForest',
    swatch: 'linear-gradient(135deg,#65a30d,#d9f99d)',
    request: {
      type: 'palette/apply',
      hue: 88,
      sat: 110,
      lightnessDelta: -1,
      desaturate: false,
    },
  },
  {
    id: 'risograph',
    swatch: 'linear-gradient(135deg,#ef4444,#22c55e,#3b82f6)',
    request: {
      type: 'palette/apply',
      hue: 340,
      sat: 120,
      lightnessDelta: 4,
      desaturate: false,
    },
  },
  {
    id: 'monoNoir',
    swatch: 'linear-gradient(135deg,#050505,#e5e7eb)',
    request: {
      type: 'palette/apply',
      hue: 0,
      sat: 0,
      lightnessDelta: 0,
      desaturate: true,
    },
  },
];

export function createPaletteBridgeScript(): string {
  return `(function(){
var N="__NEUMA_PALETTE_NONCE__";
var PROPS=["color","backgroundColor","backgroundImage","borderColor","borderTopColor","borderRightColor","borderBottomColor","borderLeftColor","outlineColor","fill","stroke","caretColor","textDecorationColor","boxShadow"];
var ROOT_SELECTOR=/(^|,)\\s*(:root|html|body|:host)\\s*($|,)/;
var cssOriginals=new WeakMap();
var cssVarOriginals=new WeakMap();
var inlineOriginals=new WeakMap();
var scheduled=false;
var current=null;
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;var max=Math.max(r,g,b),min=Math.min(r,g,b),h=0,s=0,l=(max+min)/2;if(max!==min){var d=max-min;s=l>.5?d/(2-max-min):d/(max+min);switch(max){case r:h=(g-b)/d+(g<b?6:0);break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}h*=60;}return[h,s*100,l*100];}
function hslToRgb(h,s,l){s/=100;l/=100;var c=(1-Math.abs(2*l-1))*s;var x=c*(1-Math.abs((h/60)%2-1));var m=l-c/2;var r=0,g=0,b=0;if(h<60){r=c;g=x;}else if(h<120){r=x;g=c;}else if(h<180){g=c;b=x;}else if(h<240){g=x;b=c;}else if(h<300){r=x;b=c;}else{r=c;b=x;}return[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];}
function parseColor(value){var m=value.match(/^rgba?\\(([^)]+)\\)$/i);if(m){var p=m[1].split(",").map(function(x){return x.trim();});return{r:Number.parseFloat(p[0]),g:Number.parseFloat(p[1]),b:Number.parseFloat(p[2]),a:p[3]};}m=value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);if(!m)return null;var hex=m[1];if(hex.length===3)hex=hex.split("").map(function(c){return c+c;}).join("");return{r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)};}
function recolorToken(token,settings){var color=parseColor(token);if(!color||!Number.isFinite(color.r+color.g+color.b))return token;var hsl=rgbToHsl(color.r,color.g,color.b);var s=settings.desaturate?0:clamp(hsl[1]*(settings.sat/100),0,100);var l=clamp(hsl[2]+settings.lightnessDelta,0,100);var rgb=hslToRgb(((settings.hue%360)+360)%360,s,l);return color.a===undefined?"rgb("+rgb[0]+", "+rgb[1]+", "+rgb[2]+")":"rgba("+rgb[0]+", "+rgb[1]+", "+rgb[2]+", "+color.a+")";}
function transform(value,settings){return String(value||"").replace(/#[0-9a-f]{3,6}\\b|rgba?\\([^)]*\\)/gi,function(token){return recolorToken(token,settings);});}
function originalFor(map,owner,prop,value){var record=map.get(owner);if(!record){record={};map.set(owner,record);}if(!(prop in record))record[prop]=value;return record[prop];}
function applyStyle(style,map,settings){PROPS.forEach(function(prop){var value=style[prop]||style.getPropertyValue&&style.getPropertyValue(prop.replace(/[A-Z]/g,function(c){return "-"+c.toLowerCase();}));if(!value)return;var original=originalFor(map,style,prop,value);try{style[prop]=transform(original,settings);}catch(_){try{style.setProperty(prop,transform(original,settings));}catch(__){}}});}
function resetStyle(style,map){var record=map.get(style);if(!record)return;Object.keys(record).forEach(function(prop){try{style[prop]=record[prop];}catch(_){try{style.setProperty(prop,record[prop]);}catch(__){}}});}
function originalVarFor(map,style,prop,value){var record=map.get(style);if(!record){record={};map.set(style,record);}if(!record[prop])record[prop]={value:value,priority:style.getPropertyPriority(prop)||""};return record[prop];}
function applyCustomProps(style,map,settings){for(var i=0;i<style.length;i++){var prop=style[i];if(!prop||prop.indexOf("--")!==0)continue;var value=style.getPropertyValue(prop);if(!value)continue;var next=transform(value,settings);if(next===value)continue;var original=originalVarFor(map,style,prop,value);try{style.setProperty(prop,transform(original.value,settings),original.priority);}catch(_){}}}
function resetCustomProps(style,map){var record=map.get(style);if(!record)return;Object.keys(record).forEach(function(prop){var original=record[prop];try{style.setProperty(prop,original.value,original.priority);}catch(_){}});}
function isRootRule(rule){return Boolean(rule&&rule.selectorText&&ROOT_SELECTOR.test(String(rule.selectorText)));}
function walkRules(rules,fn){if(!rules)return;for(var i=0;i<rules.length;i++){var rule=rules[i];if(rule.cssRules)walkRules(rule.cssRules,fn);if(rule.style)fn(rule.style,rule);}}
function eachSheetStyle(fn){for(var i=0;i<document.styleSheets.length;i++){try{walkRules(document.styleSheets[i].cssRules,fn);}catch(_){}}}
function eachInlineStyle(fn){document.querySelectorAll("*").forEach(function(el){fn(el.style);});}
function applyAll(){if(!current)return;eachSheetStyle(function(style,rule){applyStyle(style,cssOriginals,current);if(isRootRule(rule))applyCustomProps(style,cssVarOriginals,current);});applyCustomProps(document.documentElement.style,cssVarOriginals,current);if(document.body)applyCustomProps(document.body.style,cssVarOriginals,current);eachInlineStyle(function(style){applyStyle(style,inlineOriginals,current);});}
function resetAll(){eachSheetStyle(function(style,rule){resetStyle(style,cssOriginals);if(isRootRule(rule))resetCustomProps(style,cssVarOriginals);});resetCustomProps(document.documentElement.style,cssVarOriginals);if(document.body)resetCustomProps(document.body.style,cssVarOriginals);eachInlineStyle(function(style){resetStyle(style,inlineOriginals);});current=null;}
function schedule(){if(scheduled)return;scheduled=true;setTimeout(function(){scheduled=false;applyAll();},16);}
window.addEventListener("message",function(event){var data=event.data||{};if(data.nonce!==N)return;if(data.type==="palette/reset"){resetAll();return;}if(data.type==="palette/apply"){current={hue:Number(data.hue)||0,sat:Number(data.sat)||100,lightnessDelta:Number(data.lightnessDelta)||0,desaturate:Boolean(data.desaturate)};applyAll();}});
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["style","class"]});
window.addEventListener("load",function(){parent.postMessage({nonce:N,type:"event",payload:{type:"palette/ready"}},"*");});
})();`;
}
