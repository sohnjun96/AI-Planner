import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';
const out = 'artifacts/notes-fixes-2026-10-05';
const appUrl = process.env.PLANAI_NOTES_TEST_URL || pathToFileURL(path.resolve('dist-web/planai.html')).href;
const appOrigin = new URL(appUrl).origin;
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true});
const selectedCases = process.argv[2]?.split('|');
const report = {source:appUrl, fixture:'synthetic only', checks:[], errors:[], remoteRequests:[], aiPayloads:[]};
const now = '2026-10-05T01:00:00.000Z';
const base = {projectId:'qa-p1', tags:[], status:'active', isPinned:false, linkedTaskIds:[], createdAt:now, updatedAt:now, aiClassifiedAt:now};
const fixtureNotes = [
  {...base,id:'qa-a',title:'검색대상 회의',content:'# 검색대상 회의\n\n- [ ] 자료 취합\n- [ ] 결과 검토',sortOrder:0,sourceNoteIds:['qa-archived']},
  {...base,id:'qa-b',title:'다른 제목',content:'다른 노트 본문',sortOrder:1},
  {...base,id:'qa-c',title:'다른 프로젝트',content:'외부 분류 본문',projectId:'qa-p2',sortOrder:2},
  {...base,id:'qa-code',title:'코드 예제',content:'```markdown\n- [ ] 예제 체크\n```\n\n> - [ ] 인용 체크\n\n1. [ ] 번호 체크',sortOrder:3},
  {...base,id:'qa-archived',title:'보관 원본',content:'통합 이전 내용',status:'archived',sortOrder:4},
];
async function createPage(viewport={width:1440,height:1000}, ai=false) {
  const context = await browser.newContext({viewport,timezoneId:'Asia/Seoul',acceptDownloads:true});
  await context.route(/^https?:/,async route=>{
    const url = route.request().url();
    if(appOrigin !== 'null' && url.startsWith(`${appOrigin}/`)) return route.continue();
    report.remoteRequests.push(url);
    report.aiPayloads.push({unsavedMarker:route.request().postData()?.includes('UNIQUE_UNSAVED_MARKER')??false});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify({items:[{title:'합성 액션',startAt:'2026-10-06T09:00:00+09:00'}]})}}]})});
  });
  const page=await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`${appUrl.split('#')[0]}#/notes`);
  await expect(page.getByLabel('노트 검색',{exact:true})).toBeVisible();
  await page.evaluate(async ({fixtureNotes,now,ai})=>{
    const db=await new Promise((res,rej)=>{const r=indexedDB.open('schedule-manager-db');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
    await new Promise((res,rej)=>{
      const tx=db.transaction([...db.objectStoreNames],'readwrite');tx.oncomplete=res;tx.onerror=()=>rej(tx.error);
      for(const name of db.objectStoreNames) if(!['settings','taskTypes'].includes(name)) tx.objectStore(name).clear();
      const settings=tx.objectStore('settings');const r=settings.get('default');
      r.onsuccess=()=>settings.put({...r.result,autoBackupEnabled:false,notificationsEnabled:false,noteTaskSuggestionsEnabled:false,relatedNoteSuggestionsEnabled:false,llmEndpoint:ai?'https://notes-review.invalid/v1/chat/completions':'',llmApiKey:'',llmModel:'synthetic',updatedAt:now});
      for(const n of fixtureNotes) tx.objectStore('notes').put(n);
      for(const p of [{id:'qa-p1',name:'검토 프로젝트',color:'#2563eb'},{id:'qa-p2',name:'별도 프로젝트',color:'#059669'}]) tx.objectStore('projects').put({...p,isActive:true,createdAt:now,updatedAt:now});
    });db.close();
  },{fixtureNotes,now,ai});
  await page.reload();
  await expect(page.locator('.note-card')).toHaveCount(4);
  return {context,page};
}
async function records(page,table='notes') {
  return page.evaluate(async table=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('schedule-manager-db');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const data=await new Promise((res,rej)=>{const r=db.transaction(table).objectStore(table).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});db.close();return data},table);
}
async function putNote(page,patch) {
  await page.evaluate(async patch=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('schedule-manager-db');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});await new Promise((res,rej)=>{const tx=db.transaction('notes','readwrite');const store=tx.objectStore('notes');const r=store.get(patch.id);r.onsuccess=()=>store.put({...r.result,...patch});tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});db.close()},patch);
  await page.reload();await expect(page.locator('.note-card')).toHaveCount(4);
}
async function capture(page,name) {await page.screenshot({path:`${out}/${name}.png`,fullPage:true});}
async function setAiResponse(page, result) {
  await page.context().route(/^https?:/, route => {
    if (appOrigin !== 'null' && route.request().url().startsWith(`${appOrigin}/`)) return route.continue();
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]})});
  });
}
async function downloadArchive(page, scope) {
  await page.getByRole('button',{name:'내보내기',exact:true}).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem',{name:new RegExp(`^${scope}`)}).click();
  const download = await pending;
  const target = `${out}/export-${scope}.zip`;
  await download.saveAs(target);
  const archive = await JSZip.loadAsync(await readFile(target));
  return Object.values(archive.files).filter(file=>!file.dir);
}
async function holdNotesWrites(page, milliseconds) {
  await page.evaluate(async milliseconds=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('schedule-manager-db');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const transaction=db.transaction(['notes','noteVersions'],'readwrite');
    const until=performance.now()+milliseconds;
    const keepAlive=()=>{const request=transaction.objectStore('notes').get('synthetic-write-lock');request.onsuccess=()=>{if(performance.now()<until)keepAlive();};};
    transaction.oncomplete=()=>db.close();transaction.onerror=()=>db.close();keepAlive();
  },milliseconds);
}
async function leaveAndReopenNote(page, title) {
  await page.evaluate(()=>{location.hash='#/dashboard';});
  await expect(page.locator('.notes-workspace')).toHaveCount(0);
  await page.evaluate(()=>{location.hash='#/notes';});
  await expect(page.getByLabel('노트 검색',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:`${title} 노트 선택`,exact:true}).click();
}
const expected = {
  'normal history compare and restore': {restoredTitle:'이전 제목'},
  'mobile explorer keyboard': {focusStartsInside:true,openAfterEscape:0,focusEndsInside:true},
  'checklist search and syntax': {searchFilters:true,codeIncluded:false,numberedIncluded:true,blockquoteIncluded:true},
  'rapid checklist saves': {bothCompleted:true},
  'related archived original navigation': {title:'보관 원본',heading:'보관된 노트',originalInList:true},
  'related original navigation under search': {opened:true},
  'edited matching title under search': {editorCount:1,content:'변경된 본문'},
  'new note while search active': {editorCount:1,search:'',noteCount:6},
  'new note without search': {editorCount:1,noteCount:6},
  'save before note navigation': {saved:true},
  'AI manager destination': {hash:'#/settings?section=notes',noteActionManagerVisible:true},
  'extract actions uses latest draft': {newPayloads:[{unsavedMarker:true}]},
  'empty extracted action date': {errors:[],taskCount:0,dialogStillOpen:1},
  'code entities change on open': {unchanged:true},
  'two tabs stale draft overwrite': {firstChangePreserved:true},
  'duplicate selection in source': {selection:'반복 문장',inlineAction:true},
  'stale selection after delete': {checkedVisible:1,mergeDisabled:true},
};
async function test(name,fn,viewport,ai) {if(selectedCases&&!selectedCases.includes(name))return;let context;try {const app=await createPage(viewport,ai);context=app.context;const result=await fn(app.page);expect(result).toMatchObject(expected[name]??{});if(name.startsWith('layout ')){expect(result.geometry.controls).toEqual([]);expect(result.geometry.scrollWidth).toBe(result.geometry.width);if(viewport.width<=880)expect(result.kebabOpacity).toBe('1');}if(name==='bulk AI failure feedback')expect(result.errorTextCount).toBeGreaterThan(0);report.checks.push({name,passed:true,...result});}catch(e){report.checks.push({name,passed:false,testError:e.message});}finally{console.log(JSON.stringify(report.checks.at(-1)));await context?.close();}}
try {
  await test('normal history compare and restore',async page=>{
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    await page.getByLabel('노트 제목',{exact:true}).fill('이전 제목');await page.keyboard.press('Control+s');
    await expect.poll(async()=>(await records(page,'noteVersions')).length).toBe(1);
    await page.getByLabel('노트 제목',{exact:true}).fill('최신 제목');await page.keyboard.press('Control+s');
    await expect.poll(async()=>(await records(page,'noteVersions')).length).toBe(2);
    await page.getByRole('button',{name:'노트 더보기',exact:true}).click();await page.getByRole('menuitem',{name:/변경 이력/}).click();
    await page.getByRole('dialog',{name:'노트 변경 이력',exact:true}).getByRole('button',{name:'비교',exact:true}).last().click();
    await expect(page.getByRole('region',{name:'변경 내용',exact:true})).toBeVisible();
    await page.getByRole('region',{name:'변경 내용',exact:true}).getByRole('button',{name:'닫기',exact:true}).click();
    await page.getByRole('button',{name:'노트 더보기',exact:true}).click();await page.getByRole('menuitem',{name:/변경 이력/}).click();
    await page.getByRole('dialog',{name:'노트 변경 이력',exact:true}).getByRole('button',{name:'복원',exact:true}).click();
    await expect(page.getByLabel('노트 제목',{exact:true})).toHaveValue('이전 제목');
    return {restoredTitle:(await records(page)).find(n=>n.id==='qa-b').title};
  });
  await test('mobile explorer keyboard',async page=>{
    await page.getByRole('button',{name:'탐색',exact:true}).click();
    await expect.poll(()=>page.locator('.notes-navigation-panel').evaluate(e=>e.contains(document.activeElement))).toBe(true);
    const focusStartsInside=await page.locator('.notes-navigation-panel').evaluate(e=>e.contains(document.activeElement));
    await page.locator('.notes-navigation-panel button').last().focus();await page.keyboard.press('Tab');
    const focusEndsInside=await page.locator('.notes-navigation-panel').evaluate(e=>e.contains(document.activeElement));
    await page.keyboard.press('Escape');
    await expect(page.locator('.notes-workspace.mobile-explorer-open')).toHaveCount(0);
    const openAfterEscape=await page.locator('.notes-workspace.mobile-explorer-open').count();
    return {focusStartsInside,openAfterEscape,focusEndsInside};
  },{width:390,height:900});
  await test('checklist search and syntax',async page=>{
    await page.getByRole('button',{name:/^체크리스트/}).click();
    const before=await page.locator('.global-check-text').allTextContents();
    await page.getByLabel('노트 검색',{exact:true}).fill('자료');
    await page.waitForTimeout(250);
    const after=await page.locator('.global-check-text').allTextContents();
    await capture(page,'checklist-search');
    return {before,after,searchFilters:after.length<before.length,codeIncluded:before.includes('예제 체크'),numberedIncluded:before.includes('번호 체크'),blockquoteIncluded:before.includes('인용 체크')};
  });
  await test('rapid checklist saves',async page=>{
    await page.getByRole('button',{name:/^체크리스트/}).click();
    await page.evaluate(()=>{const a=document.querySelector('[aria-label="자료 취합 완료"]');const b=document.querySelector('[aria-label="결과 검토 완료"]');a.click();b.click();});
    await page.waitForTimeout(800);
    const note=(await records(page)).find(n=>n.id==='qa-a');
    return {content:note.content,bothCompleted:note.content.includes('- [x] 자료 취합')&&note.content.includes('- [x] 결과 검토')};
  });
  await test('related archived original navigation',async page=>{
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.locator('.note-connection-chip.related').click();
    await expect(page.getByLabel('노트 제목',{exact:true})).toHaveValue('보관 원본');
    const title=await page.getByLabel('노트 제목',{exact:true}).inputValue();
    const heading=await page.locator('.notes-list-head h2').innerText();
    const cardTitles=await page.locator('.note-card-title').allTextContents();
    await capture(page,'archived-original-navigation');
    return {title,heading,cardTitles,originalInList:cardTitles.some(t=>t.includes('보관 원본'))};
  });
  await test('related original navigation under search',async page=>{
    await page.getByLabel('노트 검색',{exact:true}).fill('검색대상');
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.locator('.note-connection-chip.related').click();
    await page.waitForTimeout(250);
    const editorCount=await page.getByLabel('노트 제목',{exact:true}).count();
    await capture(page,'related-search-clears-selection');
    return {editorCount,opened:editorCount>0};
  });
  await test('edited matching title under search',async page=>{
    await page.getByLabel('노트 검색',{exact:true}).fill('검색대상');
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.getByRole('button',{name:'원문',exact:true}).click();
    const source=page.locator('.cm-content[contenteditable=true]').last();
    await source.click();await page.keyboard.press('Control+A');await page.keyboard.insertText('변경된 본문');
    await page.getByLabel('노트 제목',{exact:true}).fill('바뀐 제목');
    await page.waitForTimeout(2700);
    const editorCount=await page.getByLabel('노트 제목',{exact:true}).count();
    await capture(page,'edit-search-closes-editor');
    return {editorCount,content:(await records(page)).find(n=>n.id==='qa-a').content};
  });
  await test('new note while search active',async page=>{
    await page.getByLabel('노트 검색',{exact:true}).fill('검색대상');
    await page.getByRole('button',{name:'+ 새 노트',exact:true}).first().click();
    await page.waitForTimeout(2200);
    await capture(page,'new-note-under-search');
    return {editorCount:await page.getByLabel('노트 제목',{exact:true}).count(),search:await page.getByLabel('노트 검색',{exact:true}).inputValue(),noteCount:(await records(page)).length};
  });
  await test('new note without search',async page=>{
    await page.getByRole('button',{name:'+ 새 노트',exact:true}).first().click();
    await page.waitForTimeout(2200);
    return {editorCount:await page.getByLabel('노트 제목',{exact:true}).count(),noteCount:(await records(page)).length};
  });
  await test('save before note navigation',async page=>{
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.getByLabel('노트 제목',{exact:true}).fill('전환 직전 수정');
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    await page.waitForTimeout(300);
    return {saved:(await records(page)).find(n=>n.id==='qa-a').title==='전환 직전 수정'};
  });
  await test('AI manager destination',async page=>{
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.getByRole('button',{name:'AI 편집',exact:true}).click();
    await page.getByRole('menuitem',{name:/기능 관리…/}).click();
    await page.waitForTimeout(200);
    return {hash:await page.evaluate(()=>location.hash),visibleHeading:await page.locator('.settings-section-heading h2').allTextContents(),noteActionManagerVisible:await page.getByRole('button',{name:'AI 편집 기능 관리',exact:true}).isVisible().catch(()=>false)};
  },undefined,true);
  await test('extract actions uses latest draft',async page=>{
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.getByRole('button',{name:'원문',exact:true}).click();
    await page.locator('.cm-content[contenteditable=true]').last().click();await page.keyboard.press('Control+A');await page.keyboard.insertText('미저장 할 일 UNIQUE_UNSAVED_MARKER');
    const previousCount=report.aiPayloads.length;
    await page.getByRole('button',{name:'AI 편집',exact:true}).click();
    await page.getByRole('menuitem',{name:/일정 추출/}).click();
    await expect(page.getByRole('dialog',{name:'추출한 액션 아이템',exact:true})).toBeVisible();
    return {newPayloads:report.aiPayloads.slice(previousCount)};
  },undefined,true);
  await test('empty extracted action date',async page=>{
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.getByRole('button',{name:'AI 편집',exact:true}).click();
    await page.getByRole('menuitem',{name:/일정 추출/}).click();
    const dialog=page.getByRole('dialog',{name:'추출한 액션 아이템',exact:true});
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('일정 시간',{exact:true}).fill('');
    const prior=report.errors.length;
    await dialog.getByRole('button',{name:'선택 1건 일정 생성',exact:true}).click();
    await page.waitForTimeout(200);
    const errors=report.errors.slice(prior);
    await capture(page,'empty-action-date');
    return {errors,taskCount:(await records(page,'tasks')).length,dialogStillOpen:await dialog.count()};
  },undefined,true);
  await test('code entities change on open',async page=>{
    const original='    const literal = "&nbsp;";\n\n> ```html\n> &#32;\n> ```';
    await putNote(page,{id:'qa-b',content:original});
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    await page.waitForTimeout(2600);
    const stored=(await records(page)).find(n=>n.id==='qa-b').content;
    await capture(page,'code-entities-on-open');
    return {original,stored,unchanged:stored===original};
  });
  await test('two tabs stale draft overwrite',async page=>{
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    const other=await page.context().newPage();other.setDefaultTimeout(5000);
    await other.goto(`${appUrl.split('#')[0]}#/notes`);
    await other.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.getByRole('button',{name:'원문',exact:true}).click();
    await page.locator('.cm-content[contenteditable=true]').last().click();await page.keyboard.press('Control+A');await page.keyboard.insertText('탭 1의 새로운 본문');
    await page.waitForTimeout(2600);
    const first=(await records(page)).find(n=>n.id==='qa-a').content;
    await other.getByLabel('노트 제목',{exact:true}).fill('탭 2의 제목 변경');
    await other.waitForTimeout(2600);
    const final=(await records(page)).find(n=>n.id==='qa-a');
    await other.close();
    return {first,finalContent:final.content,finalTitle:final.title,firstChangePreserved:first===final.content};
  });
  await test('duplicate selection in source',async page=>{
    await putNote(page,{id:'qa-b',content:'반복 문장\n\n반복 문장'});
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    await page.getByRole('button',{name:'원문',exact:true}).click();
    const source=page.locator('.cm-content[contenteditable=true]').last();await source.click();
    await page.keyboard.press('Control+End');await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
    const selection=await page.evaluate(()=>getSelection().toString());
    await source.click({button:'right'});
    const items=await page.getByRole('menuitem').allTextContents();
    return {selection,items,inlineAction:items.some(t=>t.includes('선택 영역 편집'))};
  },undefined,true);
  await test('bulk AI failure feedback',async page=>{
    await page.context().route(/^https?:/,route=>appOrigin !== 'null' && route.request().url().startsWith(`${appOrigin}/`)?route.continue():route.fulfill({status:500,contentType:'application/json',body:'{"error":{"message":"Synthetic failure"}}'}));
    await page.getByRole('button',{name:'선택',exact:true}).click();
    await page.getByLabel('검색대상 회의 선택',{exact:true}).check();
    await page.getByRole('button',{name:'요약',exact:true}).click();
    await page.waitForTimeout(600);
    return {selectedCountText:await page.locator('.notes-bulk-bar').innerText(),errorTextCount:await page.locator('.error-text').count(),bodyText:await page.locator('.notes-workspace').innerText()};
  },undefined,true);
  await test('stale selection after delete',async page=>{
    page.on('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'선택',exact:true}).click();
    await page.getByLabel('검색대상 회의 선택',{exact:true}).check();
    await page.getByLabel('다른 제목 선택',{exact:true}).check();
    await page.getByRole('button',{name:'다른 제목 메뉴',exact:true}).click();
    await page.getByRole('menuitem',{name:/삭제/}).click();
    await page.waitForTimeout(300);
    return {selectionText:await page.locator('.notes-bulk-bar').innerText(),checkedVisible:await page.locator('.note-card-check:checked').count(),mergeDisabled:await page.getByRole('button',{name:'통합',exact:true}).isDisabled()};
  },undefined,true);
  await test('single and selected summary preview',async page=>{
    await setAiResponse(page,{assistantMessage:'요약했습니다.',proposedTitle:'합성 요약',proposedContent:'# 합성 요약\n\n전체 원문을 요약한 결과'});
    await page.getByRole('button',{name:'다른 제목 메뉴',exact:true}).click();
    await page.getByRole('menuitem',{name:/^AI 요약/}).click();
    const preview=page.getByRole('dialog',{name:'AI 결과 확인',exact:true});
    await expect(preview).toBeVisible();
    expect(await records(page)).toHaveLength(5);
    await preview.getByRole('button',{name:'취소',exact:true}).click();
    expect(await records(page)).toHaveLength(5);
    await page.getByRole('button',{name:'선택',exact:true}).click();
    await page.getByLabel('검색대상 회의 선택',{exact:true}).check();
    await page.getByRole('button',{name:'요약',exact:true}).click();
    await expect(preview).toBeVisible();
    await preview.getByRole('button',{name:'새 노트로 저장',exact:true}).click();
    await expect(preview).toHaveCount(0);
    const notes=await records(page);
    expect(notes).toHaveLength(6);
    expect(notes.find(n=>n.id==='qa-a').status).toBe('active');
    expect(notes.some(n=>n.title==='합성 요약')).toBe(true);
    return {cancelKeptCount:5,savedCount:notes.length,sourceKeptActive:true};
  },undefined,true);
  await test('merge preview and atomic archive',async page=>{
    await setAiResponse(page,{assistantMessage:'통합했습니다.',proposedTitle:'합성 통합',proposedContent:'# 합성 통합\n\n첫 원문과 두 번째 원문의 내용'});
    await page.getByRole('button',{name:'선택',exact:true}).click();
    await page.getByLabel('검색대상 회의 선택',{exact:true}).check();
    await page.getByLabel('다른 제목 선택',{exact:true}).check();
    await page.getByRole('button',{name:'통합',exact:true}).click();
    const preview=page.getByRole('dialog',{name:'AI 결과 확인',exact:true});
    await expect(preview).toBeVisible();
    expect((await records(page)).filter(n=>['qa-a','qa-b'].includes(n.id)).every(n=>n.status==='active')).toBe(true);
    await preview.getByRole('button',{name:'새 노트로 저장',exact:true}).click();
    await expect(preview).toHaveCount(0);
    const notes=await records(page);
    expect(notes).toHaveLength(6);
    expect(notes.filter(n=>['qa-a','qa-b'].includes(n.id)).every(n=>n.status==='archived')).toBe(true);
    expect(notes.find(n=>n.title==='합성 통합').content).toBe('# 합성 통합\n\n첫 원문과 두 번째 원문의 내용');
    expect(notes.find(n=>n.title==='합성 통합').sourceNoteIds.sort()).toEqual(['qa-a','qa-b']);
    return {savedCount:notes.length,originalsArchived:true};
  },undefined,true);
  await test('merge rejects changed original',async page=>{
    await setAiResponse(page,{assistantMessage:'통합했습니다.',proposedTitle:'합성 통합',proposedContent:'통합 본문'});
    await page.getByRole('button',{name:'선택',exact:true}).click();
    await page.getByLabel('검색대상 회의 선택',{exact:true}).check();
    await page.getByLabel('다른 제목 선택',{exact:true}).check();
    await page.getByRole('button',{name:'통합',exact:true}).click();
    const preview=page.getByRole('dialog',{name:'AI 결과 확인',exact:true});
    await expect(preview).toBeVisible();
    await page.evaluate(async now=>{
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('schedule-manager-db');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise((resolve,reject)=>{const transaction=db.transaction('notes','readwrite');const store=transaction.objectStore('notes');const request=store.get('qa-b');request.onsuccess=()=>store.put({...request.result,content:'다른 창의 새 본문',updatedAt:new Date(Date.parse(now)+100000).toISOString()});transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});
      db.close();
    },now);
    await preview.getByRole('button',{name:'새 노트로 저장',exact:true}).click();
    await expect(preview.getByRole('alert')).toBeVisible();
    const notes=await records(page);
    expect(notes).toHaveLength(5);
    expect(notes.find(n=>n.id==='qa-b').content).toBe('다른 창의 새 본문');
    expect(notes.filter(n=>['qa-a','qa-b'].includes(n.id)).every(n=>n.status==='active')).toBe(true);
    return {retainedPreview:true,originalsKeptActive:true};
  },undefined,true);
  for(const viewport of [{width:1440,height:900},{width:390,height:900},{width:320,height:700},{width:1024,height:500}]) {
    await test(`preview layout ${viewport.width}x${viewport.height}`,async page=>{
      const content='# 합성 통합\n\n- [x] 첫 원문의 체크 항목\n- [ ] 두 번째 원문의 체크 항목\n\n'+Array.from({length:24},(_,index)=>`## 확인할 내용 ${index+1}\n\n긴 결과를 확인하고 저장합니다. ${'긴문장'.repeat(35)}\n\n| 항목 | 내용 |\n| --- | --- |\n| 자료 | 원본을 유지하며 확인 |`).join('\n\n');
      await setAiResponse(page,{assistantMessage:'통합했습니다.',proposedTitle:'합성 통합',proposedContent:content});
      await page.getByRole('button',{name:'선택',exact:true}).click();
      await page.getByLabel('검색대상 회의 선택',{exact:true}).check();
      await page.getByLabel('다른 제목 선택',{exact:true}).check();
      await page.getByRole('button',{name:'통합',exact:true}).click();
      const preview=page.getByRole('dialog',{name:'AI 결과 확인',exact:true});
      await expect(preview).toBeVisible();
      await page.waitForTimeout(250);
      await expect(preview.getByRole('heading',{name:'합성 통합',exact:true})).toHaveCount(1);
      await expect(preview.getByRole('checkbox').first()).toBeDisabled();
      const geometry=await preview.evaluate(dialog=>{
        const body=dialog.querySelector('.note-bulk-preview-content');
        const buttons=[...dialog.querySelectorAll('button')].map(button=>{const rect=button.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};});
        const rect=dialog.getBoundingClientRect();
        return {background:getComputedStyle(dialog).backgroundColor,withinViewport:rect.top>=0&&rect.bottom<=innerHeight&&rect.left>=0&&rect.right<=innerWidth,buttonsWithinViewport:buttons.every(button=>button.top>=0&&button.bottom<=innerHeight&&button.left>=0&&button.right<=innerWidth),bodyScrolls:body.scrollHeight>body.clientHeight,dialogDoesNotScroll:dialog.scrollHeight<=dialog.clientHeight+1,footerGap:buttons.at(-1).top-body.getBoundingClientRect().bottom,scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth};
      });
      expect(geometry).toMatchObject({background:'rgb(255, 255, 255)',withinViewport:true,buttonsWithinViewport:true,bodyScrolls:true,dialogDoesNotScroll:true});
      expect(geometry.footerGap).toBeGreaterThanOrEqual(12);
      expect(geometry.scrollWidth).toBe(geometry.viewportWidth);
      await capture(page,`preview-${viewport.width}x${viewport.height}`);
      await preview.getByRole('region',{name:'생성된 노트 미리보기',exact:true}).evaluate(element=>{element.scrollTop=element.scrollHeight;});
      await expect(preview.getByRole('button',{name:'새 노트로 저장',exact:true})).toBeVisible();
      await preview.getByRole('button',{name:'취소',exact:true}).click();
      await expect.poll(()=>page.getByRole('button',{name:'통합',exact:true}).evaluate(button=>document.activeElement===button)).toBe(true);
      expect((await records(page)).filter(note=>['qa-a','qa-b'].includes(note.id)).every(note=>note.status==='active')).toBe(true);
      return geometry;
    },viewport,true);
  }
  await test('export scopes and current draft',async page=>{
    await page.getByLabel('노트 검색',{exact:true}).fill('검색대상');
    await expect(page.locator('.note-card')).toHaveCount(1);
    await page.getByRole('button',{name:'선택',exact:true}).click();
    await page.getByLabel('검색대상 회의 선택',{exact:true}).check();
    expect(await downloadArchive(page,'전체 노트 내보내기')).toHaveLength(5);
    expect(await downloadArchive(page,'현재 목록 내보내기')).toHaveLength(1);
    expect(await downloadArchive(page,'선택한 노트 내보내기')).toHaveLength(1);
    await page.locator('.notes-bulk-bar').getByRole('button',{name:'취소',exact:true}).click();
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.getByLabel('노트 제목',{exact:true}).fill('내보내기 미저장 제목');
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:'노트 더보기',exact:true}).click();
    await page.getByRole('menuitem',{name:/Markdown 다운로드/}).click();
    const download=await pending;
    await download.saveAs(`${out}/current-draft.md`);
    expect(await readFile(`${out}/current-draft.md`,'utf8')).toContain('내보내기 미저장 제목');
    return {all:5,visible:1,selected:1,currentDraftIncluded:true};
  });
  await test('reverted draft stays reverted after navigation',async page=>{
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    const title=page.getByLabel('노트 제목',{exact:true});
    await title.fill('취소할 수정');
    await title.fill('다른 제목');
    await leaveAndReopenNote(page,'다른 제목');
    await expect(title).toHaveValue('다른 제목');
    expect((await records(page)).find(n=>n.id==='qa-b').title).toBe('다른 제목');
    return {revertedTitleKept:true};
  });
  await test('reverted in-flight save keeps latest draft',async page=>{
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    const title=page.getByLabel('노트 제목',{exact:true});
    await title.fill('저장 중 되돌릴 수정');
    await holdNotesWrites(page,1400);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.note-save-status')).toContainText('저장 중');
    await title.fill('다른 제목');
    await leaveAndReopenNote(page,'다른 제목');
    await expect(title).toHaveValue('다른 제목');
    await expect.poll(async()=>(await records(page)).find(n=>n.id==='qa-b').title).toBe('다른 제목');
    expect(await page.locator('.notes-conflict-panel').count()).toBe(0);
    return {revertedTitleKept:true,noConflict:true};
  });
  await test('metadata failure cannot replace another draft',async page=>{
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await page.evaluate(()=>{
      const put=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(value,...args){
        if(this.name==='notes'&&value.id==='qa-a'&&value.isPinned)throw new DOMException('합성 저장 실패','QuotaExceededError');
        return put.call(this,value,...args);
      };
    });
    await holdNotesWrites(page,1400);
    await page.getByRole('button',{name:'검색대상 회의 메뉴',exact:true}).click();
    await page.getByRole('menuitem',{name:'고정',exact:true}).click();
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    await expect(page.getByLabel('노트 제목',{exact:true})).toHaveValue('다른 제목');
    await page.waitForTimeout(1700);
    await expect(page.getByLabel('노트 제목',{exact:true})).toHaveValue('다른 제목');
    await page.getByRole('button',{name:'원문',exact:true}).click();
    await expect(page.locator('.cm-content[contenteditable=true]').last()).toHaveText('다른 노트 본문');
    expect((await records(page)).find(n=>n.id==='qa-b').content).toBe('다른 노트 본문');
    return {otherDraftKept:true};
  });
  await test('pending save reentry and immediate new save',async page=>{
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    const title=page.getByLabel('노트 제목',{exact:true});
    await title.fill('첫 번째 저장 제목');
    await holdNotesWrites(page,2000);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.note-save-status')).toContainText('저장 중');
    await leaveAndReopenNote(page,'다른 제목');
    await expect(title).toHaveValue('첫 번째 저장 제목');
    await title.fill('복귀 직후 새 제목');
    await page.keyboard.press('Control+s');
    await expect.poll(async()=>(await records(page)).find(n=>n.id==='qa-b').title).toBe('복귀 직후 새 제목');
    await expect(title).toHaveValue('복귀 직후 새 제목');
    expect(await page.locator('.notes-conflict-panel').count()).toBe(0);
    return {latestTitleSaved:true,noConflict:true};
  });
  await test('pending save reentry and unchanged manual save',async page=>{
    await page.getByRole('button',{name:'다른 제목 노트 선택',exact:true}).click();
    const title=page.getByLabel('노트 제목',{exact:true});
    await title.fill('저장 중인 동일 제목');
    await holdNotesWrites(page,2000);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.note-save-status')).toContainText('저장 중');
    await leaveAndReopenNote(page,'다른 제목');
    await expect(title).toHaveValue('저장 중인 동일 제목');
    await page.keyboard.press('Control+s');
    await expect.poll(async()=>(await records(page)).find(n=>n.id==='qa-b').title).toBe('저장 중인 동일 제목');
    await expect(page.locator('.note-save-status')).toContainText('저장됨');
    expect(await page.locator('.notes-conflict-panel').count()).toBe(0);
    return {titleKept:true,noConflict:true};
  });
  for(const width of [1440,1024,390,320]) await test(`layout ${width}`,async page=>{
    await page.mouse.move(0,0);
    const kebabOpacity=await page.locator('.note-card-kebab').first().evaluate(e=>getComputedStyle(e).opacity);
    await capture(page,`${width}-list`);
    await page.getByRole('button',{name:'검색대상 회의 노트 선택',exact:true}).click();
    await expect(page.getByLabel('노트 제목',{exact:true})).toBeVisible();
    await expect(page.locator('.note-mdx-content')).toBeVisible();
    await page.waitForTimeout(500);
    const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('.notes-detail-pane button,.notes-detail-pane input')].filter(e=>e.getClientRects().length).map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim(),left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,height:e.getBoundingClientRect().height})).filter(e=>e.left<0||e.right>innerWidth)}));
    await capture(page,`${width}-editor`);
    await page.getByRole('button',{name:'분류 및 태그 수정',exact:true}).click();
    await capture(page,`${width}-meta`);
    return {kebabOpacity,geometry};
  },{width,height:900});
} finally {
  await browser.close();
  await writeFile(`${out}/${selectedCases?'focused-report':'report'}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
expect(report.errors).toEqual([]);
expect(report.checks.filter(check=>!check.passed)).toEqual([]);
