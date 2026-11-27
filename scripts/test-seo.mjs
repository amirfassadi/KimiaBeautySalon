import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from '../dist/server/index.js';

const base='https://kbkimiabeauty.ir';
let settings={name:'سالن زیبایی کیمیا',phone:'+989307897825',address:'تهران، اشرفی اصفهانی، خیابان پیامبر شرقی، خیابان شهاب، گلستان ۱۲، پلاک ۱۱، واحد ۱',public_base_url:'https://old.example.test'};
let services=[
 {id:'nails-id',slug:'nails',name_fa:'خدمات ناخن',description_fa:null,seo_title:null,seo_description:null},
 {id:'hair-id',slug:'hair',name_fa:'خدمات مو',description_fa:''},
 {id:'eyes-id',slug:'eyes',name_fa:'ابرو و مژه',description_fa:null},
 {id:'makeup-id',slug:'makeup',name_fa:'میکاپ و گریم',description_fa:null},
 {id:'atelier-id',slug:'atelier',name_fa:'آتلیهٔ عکاسی',description_fa:null},
];
let gallery=[];
const env={SELF_HOSTED:true,SELF_HOSTED_BASE_URL:base,DB_ADAPTER:async path=>{
 if(path.startsWith('site_settings?'))return [{content:settings}];
 if(path.startsWith('services?'))return services;
 if(path.startsWith('business_hours?'))return [{iso_weekday:6,is_closed:false,opens_at:'09:00:00',closes_at:'18:00:00'},{iso_weekday:5,is_closed:true}];
 if(path.startsWith('gallery_items?'))return gallery;
 if(path.startsWith('staff_members?'))return [];
 throw new Error('Unexpected query: '+path);
}};
const call=(path,options={})=>worker.fetch(new Request('https://untrusted.example'+path,options),env);
const schema=html=>JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

let response=await call('/');
const home=await response.text();
assert.equal(response.status,200);
const title=home.match(/<title>(.*?)<\/title>/)[1];
assert.match(title,/صادقیه و غرب تهران/);
assert.ok(home.includes('property="og:title" content="'+title+'"'));
assert.equal((home.match(/<meta name="description"/g)||[]).length,1);
assert.ok(home.includes('href="'+base+'/"'));
const homeDescription=home.match(/<meta name="description" content="([^"]*)"/)[1];
assert.match(homeDescription,/سالن زیبایی/);
assert.match(homeDescription,/صادقیه، غرب تهران/);
assert.match(homeDescription,/آتلیهٔ عکاسی پرتره/);
assert.match(homeDescription,/هماهنگی مراجعه/);
assert.doesNotMatch(homeDescription,/میکاپ و گریم، خدمات مو/);
assert.equal(home.match(/<meta property="og:description" content="([^"]*)"/)[1],homeDescription);
assert.equal(home.match(/<meta name="twitter:description" content="([^"]*)"/)[1],homeDescription);
assert.match(home,/aria-label="سالن زیبایی کیمیا \| KIMIA BEAUTY &amp; ATELIER"/);
assert.doesNotMatch(home,/href="\/(?:login|register|account)(?:[?#"])/,'Customer-auth pages must not be linked from the public homepage.');
settings.name='کیمیا & "آرام"';
const dynamicNameHome=await (await call('/')).text();
assert.match(dynamicNameHome,/aria-label="کیمیا &amp; &quot;آرام&quot; \| KIMIA BEAUTY &amp; ATELIER"/);
settings.name='سالن زیبایی کیمیا';
const campaignImage=home.match(/<img src="([^"]+)" alt="تصویر تبلیغاتی مدل موی کوتاه مسی" width="744" height="390" loading="eager" decoding="async">/);
assert.ok(campaignImage,'The campaign image must use the cropped responsive asset.');
assert.ok(home.includes('<link rel="preload" as="image" href="'+campaignImage[1]+'" type="image/webp">'),'The measured campaign LCP image must be discoverable from the head.');
const campaignResponse=await call(campaignImage[1]);
assert.equal(campaignResponse.headers.get('content-type'),'image/webp');
assert.ok((await campaignResponse.arrayBuffer()).byteLength<438375,'The campaign crop must transfer fewer bytes than the original image.');
const privacyResponse=await call('/privacy');
const privacy=await privacyResponse.text();
assert.equal(privacyResponse.status,200);
assert.ok(privacy.includes('<link rel="canonical" href="'+base+'/privacy">'));
const privacyDescription=privacy.match(/<meta name="description" content="([^"]*)"/)[1];
assert.match(privacyDescription,/اطلاعات درخواست هماهنگی/);
assert.equal(privacy.match(/<meta property="og:description" content="([^"]*)"/)[1],privacyDescription);
assert.equal(privacy.match(/<meta name="twitter:description" content="([^"]*)"/)[1],privacyDescription);
assert.equal(schema(privacy).url,base+'/privacy');
assert.ok(privacy.includes('تا فعال‌شدن دیتابیس، فرم درخواست را ذخیره نمی‌کند.'));
const privacyHead=await call('/privacy',{method:'HEAD'});
assert.equal(privacyHead.status,200);
assert.equal(await privacyHead.text(),'');
const privacySlash=await call('/privacy/');
assert.equal(privacySlash.status,404);
assert.equal(privacySlash.headers.get('location'),null);
assert.match(home,/<a[^>]+href="\/services\/nails"[^>]*>کاشت ناخن در غرب تهران و صادقیه<\/a>/);
assert.doesNotMatch(home,/old\.example|untrusted\.example|__SEO_HEAD__|>null</);
const salon=schema(home)['@graph'].find(item=>item['@type']==='BeautySalon');
assert.equal(salon.address.streetAddress,settings.address);
assert.equal(salon.telephone,settings.phone);
assert.equal(salon.hasMap,'https://maps.app.goo.gl/T3swhBD3iiGWLzvk8');
assert.deepEqual(salon.geo,{'@type':'GeoCoordinates',latitude:35.7318808,longitude:51.3303384});
assert.match(home,/آرایشگاه زنانه در صادقیه/);
assert.match(home,/آیت‌الله کاشانی/);
assert.doesNotMatch(home,/__LOCAL_SEARCH__|__SALON_DIRECTIONS__/);
function checkDirections(page) {
 for(const provider of ['google','neshan','balad','waze'])assert.equal((page.match(new RegExp('<a data-map-provider="'+provider+'"','g'))||[]).length,1);
 assert.ok(page.includes('href="https://maps.app.goo.gl/T3swhBD3iiGWLzvk8"'));
 assert.ok(page.includes('href="https://neshan.org/maps/share/35.7318808,51.3303384"'));
 assert.ok(page.includes('href="https://balad.ir/directions/driving?destination=51.3303384%2C35.7318808"'));
 assert.ok(page.includes('href="https://waze.com/ul?ll=35.7318808%2C51.3303384&amp;navigate=yes&amp;utm_source=kbkimiabeauty.ir"'));
 assert.doesNotMatch(page,/google\.com\/maps\/search/,'Navigation must point to the confirmed salon, not an address search.');
}
checkDirections(home);
// Exercise the generated browser script: desktop keeps HTTPS; installed-app links
// on mobile must stay in the current tab and preserve the exact destination.
for(const [userAgent,platform,maxTouchPoints,expected] of [
 ['Mozilla/5.0 (Linux; Android 14) Chrome/130','Linux armv8l',5,'intent://'],
 ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)','iPhone',5,'neshan://'],
 ['Mozilla/5.0 (Macintosh; Intel Mac OS X)','MacIntel',5,'neshan://'],
 ['Mozilla/5.0 (Windows NT 10.0)','Win32',0,'https://neshan.org/'],
]) {
 const anchor=home.match(/<a data-map-provider="neshan"[^>]+>/)[0];
 const attr=name=>anchor.match(new RegExp(' '+name+'="([^"]+)"'))[1].replaceAll('&amp;','&');
 const link={href:attr('href'),dataset:{androidHref:attr('data-android-href'),iosHref:attr('data-ios-href')},target:'_blank',removeAttribute(name){delete this[name]},setAttribute(name,value){this[name]=value}};
 const waze={target:'_blank',removeAttribute(name){delete this[name]}};
 const nav={querySelector:selector=>selector.includes('waze')?waze:link};
 const fallback={previousElementSibling:nav,hidden:true,style:{display:'none'}};
 const script=home.match(/<script data-salon-navigation>([\s\S]*?)<\/script>/)[1];
 vm.runInNewContext(script,{document:{currentScript:{previousElementSibling:fallback}},navigator:{userAgent,platform,maxTouchPoints}});
 assert.ok(link.href.startsWith(expected));
 if(expected==='intent://') {
  assert.ok(link.href.includes('lat=35.7318808&lng=51.3303384'));
  assert.ok(link.href.includes('package=org.rajman.neshan.traffic.tehran.navigator'));
  assert.ok(link.href.includes('S.browser_fallback_url='+encodeURIComponent(attr('href'))));
 }
 if(expected==='neshan://')assert.ok(link.href.includes('destination=35.7318808,51.3303384'));
 assert.equal(fallback.hidden,expected.startsWith('https'));
 assert.equal(link.target,expected.startsWith('https')?'_blank':undefined);
 assert.equal(waze.target,expected.startsWith('https')?'_blank':undefined);
}
assert.deepEqual(salon.openingHoursSpecification,[{'@type':'OpeningHoursSpecification',dayOfWeek:'https://schema.org/Saturday',opens:'09:00',closes:'18:00'}]);
assert.equal('aggregateRating' in salon,false);
assert.equal('image' in salon,false,'Concept images must not be labeled as real salon photos.');

response=await call('/services/nails');
let html=await response.text();
assert.equal(response.status,200);
assert.match(html,/<h1>کاشت ناخن در غرب تهران و صادقیه<\/h1>/);
assert.match(html,/قیمت کاشت ناخن/);
assert.match(html,/پرسش‌های متداول خدمات ناخن/);
assert.ok(html.includes('href="tel:'+settings.phone+'"'));
checkDirections(html);
assert.doesNotMatch(html,/null|undefined|old\.example|untrusted\.example/);
assert.equal((html.match(/<h1>/g)||[]).length,1);
const graph=schema(html)['@graph'];
assert.equal(graph.find(item=>item['@type']==='Service').provider['@id'],base+'/#salon');
assert.ok(graph.some(item=>item['@type']==='BeautySalon'&&item['@id']===base+'/#salon'));
assert.equal(graph.find(item=>item['@type']==='BreadcrumbList').itemListElement[1].item,base+'/services/nails');
assert.doesNotMatch(html,/نمونه‌کارهای مرتبط/,'Empty gallery must not pretend to contain work.');

for(const path of ['/','/services/nails','/robots.txt','/sitemap.xml']) {
 response=await call(path,{method:'HEAD'});
 assert.equal(response.status,200,path+' must accept HEAD');
 assert.equal(await response.text(),'');
}
for(const [path,target] of [['/index.html?source=test','/?source=test'],['/services/nails/?source=test','/services/nails?source=test']]) {
 response=await call(path);
 assert.equal(response.status,308);
 assert.equal(response.headers.get('location'),target);
}
const sitemap=await (await call('/sitemap.xml')).text();
assert.ok(sitemap.includes(base+'/services/nails'));
assert.doesNotMatch(sitemap,/untrusted|old\.example|admin|index\.html/);
assert.doesNotMatch(sitemap,/\/(?:login|register|account)(?:\/|<)/,'Customer-auth pages must not appear in the public sitemap.');

// Every service landing page must be discoverable, unique, and available on HEAD.
const landingPages=[
 ['haircut','کوتاهی مو زنانه','پرسش‌های متداول کوتاهی مو','hair'],
 ['hair-color','رنگ مو','پرسش‌های متداول رنگ مو','hair'],
 ['eyelash-extensions','کاشت مژه و اکستنشن مژه','پرسش‌های متداول کاشت مژه','eyes'],
 ['makeup','میکاپ و گریم','پرسش‌های متداول میکاپ و گریم',null],
 ['atelier','عکاسی پرتره','پرسش‌های متداول آتلیه عکاسی',null],
];
const titles=new Set(),descriptions=new Set();
for(const [slug,keyword,faq,parent] of landingPages) {
 const path='/services/'+slug;
 response=await call(path);
 assert.equal(response.status,200,path);
 html=await response.text();
 assert.ok(html.includes(keyword)&&html.includes(faq));
 assert.equal((html.match(/<h1>/g)||[]).length,1);
 assert.ok(html.includes('href="'+base+path+'"'));
 assert.doesNotMatch(html,/null|undefined|old\.example|untrusted\.example/);
 assert.ok(sitemap.includes('<loc>'+base+path+'</loc>'));
 assert.ok(home.includes('href="'+path+'"'),'Homepage must link to '+path);
 titles.add(html.match(/<title>(.*?)<\/title>/)[1]);
 descriptions.add(html.match(/<meta name="description" content="([^"]*)"/)[1]);
 const serviceSchema=schema(html)['@graph'].find(item=>item['@type']==='Service');
 assert.equal(serviceSchema.url,base+path);
 const crumbs=schema(html)['@graph'].find(item=>item['@type']==='BreadcrumbList').itemListElement;
 assert.equal(crumbs.length,parent?3:2);
 if(parent)assert.equal(crumbs[1].item,base+'/services/'+parent);
 response=await call(path,{method:'HEAD'});
 assert.equal(response.status,200);
 assert.equal(await response.text(),'');
}
assert.equal(titles.size,landingPages.length);
assert.equal(descriptions.size,landingPages.length);
// The decision guides must remain usable without client JS: each shortcut
// resolves, tables have accessible headers and every service link is available.
for(const slug of ['haircut','hair-color','nails','atelier']) {
 const page=await (await call('/services/'+slug)).text();
 const shortcuts=page.match(/<nav class="service-guide-nav"[\s\S]*?<\/nav>/)?.[0];
 assert.ok(shortcuts,'Decision guide shortcuts missing for '+slug);
 for(const [,id] of shortcuts.matchAll(/href="#([^"]+)"/g)) {
  assert.equal(page.split('id="'+id+'"').length-1,1,'Shortcut must resolve once: '+id);
 }
 assert.match(page,/<caption>[^<]+<\/caption>/);
 assert.match(page,/<th scope="col">/);
 assert.match(page,/<th scope="row">/);
 assert.ok(page.includes('href="https://instagram.com/'+(slug==='atelier'?'kb.kimia.studio':'kb.kimiabeauty')+'"'));
 for(const [,path] of page.matchAll(/href="(\/services\/[a-z-]+)"/g)) {
  assert.equal((await call(path)).status,200,'Broken guide destination '+path);
 }
 assert.doesNotMatch(page,/aggregateRating|priceCurrency|FAQPage/,'Do not invent reviews, prices or FAQ rich-result eligibility.');
}
assert.doesNotMatch(home,/<option value="(?:haircut|hair-color|eyelash-extensions)"/,'Informational pages must not become booking IDs.');

// General hair photos cannot be presented as a specific haircut or color job.
settings.instagram_studio='https://instagram.com/custom.kimia.studio';
html=await (await call('/services/atelier')).text();
assert.ok(html.includes('href="'+settings.instagram_studio+'"'),'Studio samples must use the managed studio profile.');
assert.doesNotMatch(html,/<img[^>]+src="\/media\//,'Concept images must not become studio portfolio photos.');
services.find(s=>s.slug==='makeup').is_active=false;
assert.doesNotMatch(await (await call('/services/atelier')).text(),/href="\/services\/makeup"/);
services.find(s=>s.slug==='makeup').is_active=true;
services.find(s=>s.slug==='atelier').is_active=false;
assert.equal((await call('/services/atelier')).status,404);
assert.doesNotMatch(await (await call('/')).text(),/href="\/services\/atelier"/);
assert.doesNotMatch(await (await call('/sitemap.xml')).text(),/services\/atelier/);
services.find(s=>s.slug==='atelier').is_active=true;
gallery=[{service_id:'hair-id',image_url:'/uploads/hair.webp',alt_text_fa:'نمونه عمومی مو'}, {image_url:'/uploads/unassigned.webp',alt_text_fa:'تصویر بدون خدمت'}];
html=await (await call('/services/haircut')).text();
assert.doesNotMatch(html,/uploads\/hair\.webp|uploads\/unassigned\.webp/);
assert.match(await (await call('/services/hair')).text(),/uploads\/hair\.webp/);

// A real child service owns its copy and gallery; an explicit inactive record blocks the default.
services.push({id:'cut-id',slug:'haircut',name_fa:'کوتاهی اختصاصی',description_fa:'توضیح کوتاهی مدیر',seo_title:'عنوان کوتاهی مدیر',seo_description:'شرح سئوی مدیر',is_active:true});
gallery.push({service_id:'cut-id',image_url:'/uploads/cut.webp',alt_text_fa:'نمونه کوتاهی'});
html=await (await call('/services/haircut')).text();
assert.match(html,/<title>عنوان کوتاهی مدیر<\/title>/);
assert.match(html,/توضیح کوتاهی مدیر/);
assert.match(html,/uploads\/cut\.webp/);
assert.equal((await (await call('/sitemap.xml')).text()).split('<loc>'+base+'/services/haircut</loc>').length-1,1);
services.find(s=>s.slug==='haircut').is_active=false;
assert.equal((await call('/services/haircut')).status,404);
assert.doesNotMatch(await (await call('/')).text(),/href="\/services\/haircut"/);
assert.doesNotMatch(await (await call('/sitemap.xml')).text(),/services\/haircut/);
assert.doesNotMatch(await (await call('/services/hair-color')).text(),/href="\/services\/haircut"/,'Contextual links must respect inactive services.');
services.find(s=>s.slug==='hair').is_active=false;
services.find(s=>s.slug==='eyes').is_active=false;
for(const slug of ['hair','haircut','hair-color','eyes','eyelash-extensions']) {
 assert.equal((await call('/services/'+slug)).status,404,slug+' must not be resurrected');
 assert.ok(!(await (await call('/sitemap.xml')).text()).includes('/services/'+slug+'</loc>'));
}
assert.equal((await call('/services/makeup')).status,200,'Unrelated active services remain available.');
services.find(s=>s.slug==='haircut').is_active=true;
assert.equal((await call('/services/haircut')).status,200,'An explicitly active child can be managed independently.');

// Preserve authored SEO and service copy, including safe script termination.
services[0]={...services[0],seo_title:'عنوان اختصاصی & کیمیا',seo_description:'توضیح اختصاصی </script><script>bad()</script>',description_fa:'شرح ثبت‌شده توسط مدیر',details_fa:'جزئیات ثبت‌شده توسط مدیر'};
html=await (await call('/services/nails')).text();
assert.match(html,/<title>عنوان اختصاصی &amp; کیمیا<\/title>/);
assert.match(html,/شرح ثبت‌شده توسط مدیر/);
assert.match(html,/جزئیات ثبت‌شده توسط مدیر/);
assert.equal(schema(html)['@graph'].find(item=>item['@type']==='Service').description,services[0].seo_description);
assert.doesNotMatch(html,/<script>bad\(\)<\/script>/);
services=services.filter(item=>item.slug!=='nails');
assert.equal((await call('/services/nails')).status,404);
assert.doesNotMatch(await (await call('/')).text(),/href="\/services\/nails"/);
assert.doesNotMatch(await (await call('/sitemap.xml')).text(),/services\/nails/);

console.log('SEO regression checks passed: null content, local search copy, metadata, schema, canonical host, links, HEAD, redirects, authored content, script escaping and inactive services.');
