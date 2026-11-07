import { createCatalogLoader } from "./catalog-request.js";
import { normalizeSearch as normalize, querySearchTokens as queryTokens, createIndexedSearchMatcher } from "../src/utils/search.js";
import { createResultRow } from "./directory-results.js";
import { readDirectoryState, writeDirectoryState, restoreDirectoryView } from "./directory-state.js";
const {score:scoreRecord}=createIndexedSearchMatcher();
let geography;
const root=document.querySelector("[data-directory-search]");
if(root){
const listen=(node,type,callback,options)=>node?.addEventListener(type,callback,options);
const control=key=>root.querySelector(`[data-directory-${key}]`);
const input=control("query"),place=control("place");
const startup=root.rwnDirectoryStartup||{};let composing=Boolean(startup.composing);
document.dispatchEvent(new Event("rwn-directory-ready"));delete root.rwnDirectoryStartup;
const clear=control("clear");
const retry=control("retry");
const showRetry=(visible,busy=false)=>{
  if(!retry)return;
  const focused=document.activeElement===retry;
  retry.hidden=!visible;
  retry.setAttribute("aria-disabled",String(busy));
  if(!visible&&focused)input?.focus();
};
const country=control("country");
const need=control("need");
const count=control("count");
const announce=text=>{if(count)count.textContent=text;};
const chips=control("categories");
const shell=root.closest(".directory-shell");
const pageRecords=[...document.querySelectorAll(".directory-records > .directory-record")];
const make=tag=>document.createElement(tag),format=value=>value.toLocaleString();
const cancelInput=()=>clearTimeout(inputTimer);
const collator=new Intl.Collator(undefined,{sensitivity:"base"});
const BATCH=60,pagePath=location.pathname;
const readState=()=>readDirectoryState(history.state,pagePath);
const currentScope=pagePath.replace(/\/page\/\d+\/?$/,"").replace(/\/$/,"")||"/directory";
const releaseVersion=new URL(import.meta.url).searchParams.get("v");
const searchIndexUrl=`/data/search-index.json${releaseVersion?`?v=${encodeURIComponent(releaseVersion)}`:""}`;
let labels=[...new Set((need?[...need.options].map(option=>option.value):pageRecords.flatMap(record=>[...record.querySelectorAll(".directory-aid li")].map(item=>item.textContent.trim()))).filter(value=>value))].sort(collator.compare);
let activeCategory="",generation=0,activeMatches=[],visibleCount=0,scopedCount=0;
let rendered="",restored,saved=readState(),restorePending=false,browse=false;
const remember=(scroll=window.scrollY)=>writeDirectoryState(history,pagePath,{...(restorePending?restored:{shown:visibleCount,scroll,focus:document.activeElement?.closest?.('a[href^="/service/"]')?.getAttribute("href")||""}),query:input?.value||"",category:activeCategory,country:country?.value||""});
const stopRestore=()=>{restorePending=false;};
for(const type of ["pointerdown","keydown","wheel","touchstart"])listen(window,type,stopRestore,{passive:true});
listen(window,"pagehide",()=>remember());
listen(document,"click",event=>{if(event.target.closest?.('a[href$="#saved"]')&&location.hash!=="#saved")saved=remember();},true);
if(country)country.disabled=false;
if(need)need.disabled=false;
// Templates keep authored markup in generated HTML. The compact fallbacks
// preserve search for an older document which requests this entry during update.
const clone=key=>control(key)?.content.firstElementChild.cloneNode(true);
const notice=clone("notice")||make("p");
notice.id="offlineDirectoryNotice";notice.hidden=true;notice.setAttribute("role","status");notice.tabIndex=-1;
if(!notice.textContent)notice.textContent="Offline copy. Reconnect before travel.";
root.insertAdjacentElement("beforebegin",notice);
const results=clone("results")||make("section");
results.hidden=true;results.className="directory-global-results";results.setAttribute("aria-label","Directory search results");
if(!results.childElementCount)results.innerHTML='<span data-global-summary></span><div data-global-list></div><button type="button" data-directory-more></button>';
root.insertAdjacentElement("afterend",results);
const resultPart=key=>results.querySelector(`[data-${key}]`);
const resultList=resultPart("global-list"),resultSummary=resultPart("global-summary"),more=resultPart("directory-more");
const renderNext=(batch=BATCH)=>{const rows=activeMatches.slice(visibleCount,visibleCount+batch).map(resultRow);resultList.append(...rows);visibleCount+=rows.length;const remaining=activeMatches.length-visibleCount;more.hidden=!remaining;more.textContent=`Show ${Math.min(remaining,BATCH)} more listings`;resultSummary.textContent=`${format(visibleCount)} of ${format(activeMatches.length)} matches · ${format(scopedCount)} listings`;return rows[0];};
listen(more,"click",()=>{renderNext()?.querySelector("a")?.focus();remember();});
const showConnectivityState=()=>{if(!notice.dataset.networkState)notice.hidden=navigator.onLine;};
const scopedRecords=payload=>currentScope==="/directory"?payload.records:(payload.scopes[currentScope]||[]).map(index=>payload.records[index]).filter(value=>value);
// One set of labels and one selected category drive both responsive controls.
const renderChips = () => {
  const expected = ["", ...labels];
  for (const node of [chips, need]) {
    if (!node) continue;
    const select = node === need;
    const value = child => select ? child.value : child.dataset.directoryCategory;
    if (JSON.stringify([...node.children].map(value)) !== JSON.stringify(expected)) {
      node.replaceChildren(...expected.map(value => {
        const item = make(select ? "option" : "button");
        item.textContent = value || "All help";
        if (select) item.value = value;
        else { item.type = "button"; item.dataset.directoryCategory = value; }
        return item;
      }));
    }
    if (select) node.value = labels.find(label => normalize(label) === activeCategory) || "";
    else for (const button of node.children) button.setAttribute("aria-pressed", String(normalize(value(button)) === activeCategory));
  }
};
const syncCategoryLabels=payload=>{const full=[...new Set(scopedRecords(payload).flatMap(record=>record.categoryLabels||[]).filter(value=>value))].sort(collator.compare);if(JSON.stringify(full)===JSON.stringify(labels))return;labels=full;renderChips();};
const loadCatalog=createCatalogLoader(searchIndexUrl,true);
const clearGlobalResults=()=>{activeMatches=[];visibleCount=0;more.hidden=true;results.hidden=true;resultList.replaceChildren();shell?.classList.remove("has-global-search");announce(`${format(pageRecords.length)} listings on this page`);};
const resultRow=record=>createResultRow(record,notice);
const restoreView=()=>{if(!restorePending||shell?.classList.contains("has-saved-view"))return;restoreDirectoryView(results.hidden?shell:resultList,restored,browse?input:null);restorePending=false;};
const queueView=v=>requestAnimationFrame(()=>v===generation&&restoreView());
// A background worker can claim this page between pointerdown and click.
// Retain settled row nodes only for the same complete ordered records and online
// rendering mode; fresh changed/withdrawn data, errors and history still rebuild.
const apply=async(force)=>{if(composing&&!force)return;const intent=root.rwnIntent?.render(),tokens=queryTokens(intent?.query??[input?.value,place?.value].join(" ").trim());const filtering=!!(tokens.length||intent?.area||activeCategory||country?.value),version=++generation;if(clear)clear.hidden=!input?.value&&!place?.value&&!activeCategory&&!country?.value;root.classList.toggle("has-filter",filtering);if(!filtering){showRetry(false);clearGlobalResults();queueView(version);remember();return;}showRetry(document.activeElement===retry,true);announce("Searching this directory…");try{const payload=await loadCatalog();if(version!==generation)return;showRetry(false);syncCategoryLabels(payload);const scoped=scopedRecords(payload).filter(record=>!country?.value||record.country===country.value);const matches=scoped.filter(record=>(!root.rwnIntent||root.rwnIntent.matches(record))&&(!activeCategory||record.categoryLabels.some(label=>normalize(label)===activeCategory))).map(record=>[record,scoreRecord(record,tokens)]).filter(([,score])=>score>=0).sort(([a,x],[b,y])=>y-x||collator.compare(a.name,b.name));const signature=JSON.stringify([navigator.onLine,matches]),same=visibleCount&&!restorePending&&signature===rendered;rendered=signature;activeMatches=matches.map(([record])=>record);scopedCount=scoped.length;if(tokens.length||geography)(geography ||= import("./directory-geography.js?v="+(releaseVersion||""))).then(module=>{if(version===generation)module.renderGeographyHint(results,activeMatches,tokens,normalize);}).catch(()=>{});if(!same){visibleCount=0;resultList.replaceChildren();}renderNext(same?0:BATCH);if(restorePending&&restored){while(visibleCount<Math.min(restored.shown,activeMatches.length))renderNext();queueView(version);}if(!matches.length){const empty=control("empty")?.content.firstElementChild.cloneNode(true)||make("div");empty.className="directory-global-empty";if(!empty.childElementCount)empty.textContent="No matches. Clear filters.";const fewer=empty.querySelector("[data-fewer-words]");if(fewer){fewer.hidden=!tokens.length;fewer.onclick=()=>{input.value="";apply();input.focus();};}listen(empty.querySelector("[data-clear-all]"),"click",reset);resultList.append(empty);}results.hidden=false;shell?.classList.add("has-global-search");announce(matches.length?`${format(matches.length)} matching ${matches.length===1?"listing":"listings"}${navigator.onLine?"":" · offline copy"}`:"No matching listings");if(!restorePending)remember();}catch{if(version!==generation)return;clearGlobalResults();restoreView();showRetry(true);announce("Search unavailable. Browse below or retry.");}};
const reset=()=>{cancelInput();if(input)input.value="";if(place)place.value="";root.rwnIntent?.restore(null);activeCategory="";if(country)country.value="";stopRestore();renderChips();apply(true);input?.focus();remember();};
let inputTimer;
listen(country,"change",()=>{cancelInput();stopRestore();apply();});
listen(need,"change",()=>{cancelInput();stopRestore();activeCategory=normalize(need.value);renderChips();apply();});
const restore=event=>{if(location.hash==="#saved"||shell?.classList.contains("has-saved-view")){stopRestore();return;}const entry=startup.edited?saved=remember(startup.scroll):readState();startup.edited=false;browse=event?.detail==="browse";restored=entry||(browse?saved:null);if(!restored){stopRestore();return;}event?.preventDefault?.();cancelInput();restorePending=true;input.value=restored.query;activeCategory=restored.category;if(country)country.value=restored.country;renderChips();if(!entry)writeDirectoryState(history,pagePath,restored);apply();};
listen(window,"popstate",restore);
listen(window,"rwn-directory-restore",restore);
listen(navigator.serviceWorker,"controllerchange",()=>{loadCatalog.reset();generation++;cancelInput();apply();});
const queueInput=event=>{if(event?.target===place)place.rwnEdited=1;stopRestore();generation++;cancelInput();if(!composing&&!event?.isComposing)inputTimer=setTimeout(apply,80);};
listen(input,"focus",()=>{const version=generation;loadCatalog().then(payload=>{if(version===generation)syncCategoryLabels(payload);}).catch(()=>{});},{once:true});for(const field of [input,place]){listen(field,"input",queueInput);for(const type of ["compositionstart","compositionend"])listen(field,type,event=>{composing=type==="compositionstart";queueInput(event);});}listen(input,"keydown",event=>{if(event.key==="Escape"&&!composing&&!event.isComposing){event.preventDefault();reset();}});listen(clear,"click",reset);listen(retry,"click",()=>{if(retry.getAttribute("aria-disabled")!=="true")apply();});listen(chips,"click",event=>{const button=event.target.closest("[data-directory-category]");if(!button)return;cancelInput();activeCategory=normalize(button.dataset.directoryCategory);renderChips();apply();});listen(document,"keydown",event=>{if(!event.altKey||(event.key!=="/"&&event.code!=="Slash")||event.metaKey||event.ctrlKey||event.defaultPrevented||event.isComposing)return;if(event.target?.matches?.("input,textarea")||event.target?.isContentEditable)return;event.preventDefault();input?.focus();});const connectivityChanged=()=>{showConnectivityState();loadCatalog.retry();if(!results.hidden||input?.value||place?.value||activeCategory||country?.value)apply();};for(const type of ["online","offline","rwn-connection-restored"])listen(window,type,connectivityChanged);showConnectivityState();renderChips();clearGlobalResults();
if(startup.browse&&location.hash==="#directory-results"){if(!readState())startup.edited=true;restore({detail:"browse"});}else if(startup.edited||!readState()&&(startup.scroll!==undefined||input?.value||country?.value)){if(location.hash==="#saved")saved=remember(startup.scroll);else{startup.edited=false;apply();}}else restore();
}
if("serviceWorker" in navigator&&window.isSecureContext){const register=()=>navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(()=>{});if(document.readyState==="complete")register();else window.addEventListener("load",register,{once:true});}
