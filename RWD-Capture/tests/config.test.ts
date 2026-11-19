import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,deviceOptions,schema} from '../server/config.js';
test('all 24 combinations preserve desktop false and device pixel ratios',()=>{assert.equal(defaults.profiles.length*defaults.resolutions.length,24);for(const p of defaults.profiles){const desktop=deviceOptions(p,defaults.resolutions[0]);assert.equal(desktop.isMobile,false);assert.equal(desktop.hasTouch,false);assert.equal(desktop.deviceScaleFactor,1);assert.equal(desktop.userAgent,p.desktopUserAgent);const mobile=deviceOptions(p,defaults.resolutions[9]);assert.equal(mobile.viewport.width,375);assert.equal(mobile.deviceScaleFactor,2);assert.equal(mobile.userAgent,p.mobileUserAgent)}});
test('invalid resolutions and duplicate names are rejected',()=>{assert.equal(schema.safeParse({...defaults,resolutions:[{name:'x',width:0,height:800}]}).success,false);assert.equal(schema.safeParse({...defaults,profiles:[defaults.profiles[0],defaults.profiles[0]]}).success,false)});

test('中文標題與設定名稱可保存，舊設定沿用預設標題', () => {
  const {name, ...legacy} = defaults;
  assert.equal(schema.parse(legacy).name, '截圖小幫手');
  const config = schema.parse({
    ...legacy, name: '網頁截圖工具',
    profiles: [{name:'瀏覽器 Chrome', browserChannel:'chrome'}],
    resolutions: [{name:'手機_窄版-375', width:375, height:667}]
  });
  assert.equal(config.name, '網頁截圖工具');
  assert.equal(config.resolutions[0].name, '手機_窄版-375');
});

test('設定名稱不可離開輸出目錄或在 Windows 產生衝突', () => {
  for (const name of ['../首頁', '子目錄\\首頁', 'CON', 'nul', '手機.', '手機 ', '首頁:1', '']) {
    assert.equal(schema.safeParse({...defaults, profiles:[{name}]}).success, false, name);
  }
  assert.equal(schema.safeParse({...defaults, profiles:[{name:'中文ABC'},{name:'中文abc'}]}).success,false);
});
