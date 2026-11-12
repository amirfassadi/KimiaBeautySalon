// Coordinates from the owner's Google Maps listing, not the map viewport center.
const SALON_LOCATION = Object.freeze({latitude:35.7318808,longitude:51.3303384,google:'https://maps.app.goo.gl/T3swhBD3iiGWLzvk8'});
const SALON_NAVIGATION_CSS = `.salon-directions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin:18px 0}.salon-directions a{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-width:76px;min-height:76px;padding:10px 12px;border:1px solid rgba(216,182,117,.35);border-radius:14px;background:#10241b;color:#f5f0e7;text-decoration:none;font:500 12px/1.5 Estedad,Tahoma,sans-serif;transition:background .2s,border-color .2s}.salon-directions a:hover{background:#1b382a;border-color:#d8b675}.salon-directions a:focus-visible{outline:2px solid #ecd7ac;outline-offset:4px}.salon-directions svg{width:26px;height:26px;flex-shrink:0}.local-search-copy{max-width:760px;line-height:2;color:#c0b7a9}.local-service-links{display:flex;flex-wrap:wrap;gap:10px 22px;padding:0;list-style:none}.local-service-links a{color:#d8b675;text-underline-offset:4px}`;
function salonDirections() {
 const {latitude,longitude,google}=SALON_LOCATION;
 const neshanWeb=`https://neshan.org/maps/share/${latitude},${longitude}`;
 const neshanAndroid=`intent://nshn.ir/?lat=${latitude}&lng=${longitude}#Intent;scheme=https;package=org.rajman.neshan.traffic.tehran.navigator;S.browser_fallback_url=${encodeURIComponent(neshanWeb)};end`;
 const neshanIos=`neshan://?destination=${latitude},${longitude}`;
 const providers=[
  ['google', 'گوگل مپ',google,'#8fce91'],
  ['neshan','نشان',neshanWeb,'#75baff'],
  // Balad's driving page uses GeoJSON order: longitude, latitude.
  ['balad','بلد',`https://balad.ir/directions/driving?destination=${longitude}%2C${latitude}`,'#ff9696'],
  ['waze','ویز',`https://waze.com/ul?ll=${latitude}%2C${longitude}&navigate=yes&utm_source=kbkimiabeauty.ir`,'#7ee5ef'],
 ];
 return '<nav class="salon-directions" aria-label="انتخاب مسیریاب سالن">'+providers.map(([id,label,url,color])=>`<a data-map-provider="${id}" ${id==='neshan'?`data-android-href="${escapeHtml(neshanAndroid)}" data-ios-href="${escapeHtml(neshanIos)}"`:''} href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="باز کردن مکان سالن در ${label}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M12 22s8-8 8-14a8 8 0 0 0-16 0c0 6 8 14 8 14Z" fill="${color}"/><path d="m9 12 3-7 3 7-3-1-3 1Z" fill="#10241b"/></svg><span>${label}</span></a>`).join('')+'</nav>'+`<a data-neshan-web-fallback hidden href="${escapeHtml(neshanWeb)}" target="_blank" rel="noopener noreferrer" style="display:none;font-size:12px;color:#d8b675;text-decoration:underline">نسخهٔ وب نشان ↗</a><script data-salon-navigation>(${enhanceSalonDirections.toString()})(document.currentScript.previousElementSibling.previousElementSibling,navigator,document.currentScript.previousElementSibling);</script>`;
}
// Change the anchor before the user's tap; no timer or popup can lose user activation.
function enhanceSalonDirections(nav,device,fallback) {
 const link=nav.querySelector('[data-map-provider="neshan"]');
 const android=/Android/i.test(device.userAgent);
 const ios=/iPhone|iPad|iPod/i.test(device.userAgent)||(device.platform==='MacIntel'&&device.maxTouchPoints>1);
 if(!android&&!ios)return;
 // Universal app links should open from the user's current browsing context.
 nav.querySelector('[data-map-provider="waze"]').removeAttribute('target');
 link.href=android?link.dataset.androidHref:link.dataset.iosHref;
 link.removeAttribute('target');
 link.setAttribute('aria-label','باز کردن برنامهٔ نشان برای مسیر سالن');
 fallback.hidden=false;
 fallback.style.display='inline-block';
}
function localServiceDiscovery(catalog) {
 return '<p class="local-search-copy">برای انتخاب آرایشگاه زنانه در صادقیه و غرب تهران، خدمات سالن زیبایی کیمیا را ببینید. سالن در اشرفی اصفهانی، خیابان پیامبر شرقی قرار دارد؛ برای دسترسی از سمت آیت‌الله کاشانی، از مسیریاب دلخواهتان استفاده کنید.</p><ul class="local-service-links">'+catalog.filter(s=>['haircut','hair-color','nails','eyelash-extensions','makeup'].includes(s.slug)).map(s=>`<li><a href="/services/${encodeURIComponent(s.slug)}">${escapeHtml(s.name_fa)} در صادقیه</a></li>`).join('')+'</ul>';
}
