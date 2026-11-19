import {z} from 'zod';
const device={isMobile:z.boolean().optional(),hasTouch:z.boolean().optional(),deviceScaleFactor:z.number().min(1).max(4).optional()};
const configName = z.string()
  .regex(/^[A-Za-z0-9_\-\p{Script=Han}]+(?: [A-Za-z0-9_\-\p{Script=Han}]+)*$/u,
    '名稱可使用中文、英文字母、數字、底線、連字號，以及字詞間的空格')
  .refine(name => !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name),
    '請勿使用 Windows 保留名稱');

function uniqueNames(entries: {name: string}[]) {
  return new Set(entries.map(entry => entry.name.toLowerCase())).size === entries.length;
}
export const defaultToolName = '截圖小幫手';
const toolName = z.string().trim().min(1, '請輸入工具名稱').max(80, '工具名稱最多 80 個字元');
export const schema=z.object({name:toolName.default(defaultToolName),profiles:z.array(z.object({name:configName,browserChannel:z.enum(['chrome','msedge']).optional(),browserExecutablePath:z.string().optional(),desktopUserAgent:z.string().optional(),mobileUserAgent:z.string().optional(),...device})).min(1),resolutions:z.array(z.object({name:configName,width:z.number().int().min(200).max(7680),height:z.number().int().min(200).max(4320),...device})).min(1),settings:z.object({extraWaitMs:z.number().min(0).max(60000),readySelector:z.string(),headed:z.boolean()}).default({extraWaitMs:800,readySelector:'',headed:false})}).refine(c=>uniqueNames(c.profiles)&&uniqueNames(c.resolutions),'名稱不能重複');
export type Config=z.infer<typeof schema>;
export function deviceOptions(p:Config['profiles'][number],r:Config['resolutions'][number]){const isMobile=r.isMobile??p.isMobile??r.width<1024;return {viewport:{width:r.width,height:r.height},screen:{width:r.width,height:r.height},isMobile,hasTouch:r.hasTouch??p.hasTouch??isMobile,deviceScaleFactor:r.deviceScaleFactor??p.deviceScaleFactor??1,userAgent:isMobile?p.mobileUserAgent:p.desktopUserAgent};}
export const defaults:Config={name:defaultToolName,profiles:['chrome','msedge'].map((channel)=>({name:channel,browserChannel:channel as 'chrome'|'msedge',desktopUserAgent:`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${channel==='chrome'?148:149}.0.0.0 Safari/537.36${channel==='msedge'?' Edg/149.0.0.0':''}`,mobileUserAgent:`Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${channel==='chrome'?148:149}.0.0.0 Mobile Safari/537.36${channel==='msedge'?' EdgA/149.0.0.0':''}`,isMobile:true,hasTouch:true,deviceScaleFactor:2})),resolutions:[[2500,1080,1],[1440,768,1],[1024,1366,2],[1023,1366,2],[768,1024,2],[767,1024,2],[650,932,3],[550,932,3],[450,932,3],[375,667,2],[374,667,2],[320,800,3]].map(([width,height,deviceScaleFactor])=>({name:`${width>=1440?'desktop':width>=767?'tablet':'mobile'}-${width}`,width,height,isMobile:width<1440,hasTouch:width<1440,deviceScaleFactor})),settings:{extraWaitMs:800,readySelector:'',headed:false}};
