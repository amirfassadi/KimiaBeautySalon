const messages = {
  fa: {
    navAbout: "درباره کیمیا", navServices: "خدمات", navContact: "ارتباط",
    eyebrow: "KIMIA BEAUTY · زیبایی به سبک شما",
    heroTitle: "فرصتی برای درخشیدن، به سبک خودت.",
    heroDescription: "به فضای کیمیا خوش آمدید. فهرست خدمات پس از تأیید سالن اینجا در دسترس خواهد بود. برای هماهنگی با کیمیا تماس بگیرید.",
    exploreServices: "دیدن خدمات", aboutEyebrow: "آشنایی", aboutTitle: "جایی برای لحظه‌های خودت",
    servicesEyebrow: "آنچه ارائه می‌کنیم", servicesTitle: "خدمات کیمیا",
    servicesNote: "نام، مدت و قیمت خدمات پس از تأیید سالن نمایش داده می‌شود.",
    servicesEmpty: "فهرست خدمات در حال آماده‌سازی است.",
    pricePending: "قیمت پس از تأیید", duration: "دقیقه", contactEyebrow: "در ارتباط باشیم",
    contactTitle: "منتظر دیدار شما هستیم", contactDescription: "برای هماهنگی و پرس‌وجو با کیمیا تماس بگیرید یا صفحهٔ اینستاگرام سالن را ببینید.",
    phone: "تلفن", email: "ایمیل", address: "نشانی", social: "شبکه اجتماعی", footer: "ساخته‌شده برای تجربهٔ کیمیا",
    loadError: "اطلاعات سایت بارگذاری نشد. لطفاً صفحه را دوباره باز کنید."
  },
  en: {
    navAbout: "About", navServices: "Services", navContact: "Contact",
    eyebrow: "KIMIA BEAUTY · A moment for you",
    heroTitle: "Your moment to shine.",
    heroDescription: "Welcome to Kimia. The service catalog will be available here once confirmed by the salon. Contact Kimia for details.",
    exploreServices: "Explore services", aboutEyebrow: "Our story", aboutTitle: "A space to be yourself",
    servicesEyebrow: "What we offer", servicesTitle: "Kimia services",
    servicesNote: "Services, durations and prices will appear once confirmed by the salon.",
    servicesEmpty: "The service catalog is being prepared.",
    pricePending: "Price to be confirmed", duration: "min", contactEyebrow: "Get in touch",
    contactTitle: "We look forward to meeting you", contactDescription: "Call Kimia or visit the salon's Instagram page for more information.",
    phone: "Phone", email: "Email", address: "Address", social: "Social", footer: "Made for the Kimia experience",
    loadError: "Site information could not be loaded. Please try again."
  }
};

let site;
let locale = localStorage.getItem("kimia-locale") === "en" ? "en" : "fa";
const localized = (value) => typeof value === "string" ? value : value?.[locale] || value?.[site?.defaultLocale] || "";

function setLocale(next) {
  locale = site.supportedLocales.includes(next) ? next : site.defaultLocale;
  localStorage.setItem("kimia-locale", locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "fa" ? "rtl" : "ltr";
  document.title = `${localized(site.businessProfile.name)} | Kimia Beauty`;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = messages[locale][element.dataset.i18n];
  });
  document.querySelector("#locale-switch").textContent = locale === "fa" ? "EN" : "فا";
  document.querySelector("#about-description").textContent = localized(site.businessProfile.description);
  renderServices();
  renderContact();
}

function renderServices() {
  const container = document.querySelector("#service-list");
  container.replaceChildren();
  const services = site.serviceCatalog.filter((service) => service.active && service.public);
  if (!services.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = messages[locale].servicesEmpty;
    container.append(empty);
    return;
  }
  services.forEach((service) => {
    const card = document.createElement("article");
    card.className = "service-card";
    const category = document.createElement("p"); category.className = "eyebrow"; category.textContent = localized(service.category);
    const title = document.createElement("h3"); title.textContent = localized(service.name);
    const description = document.createElement("p"); description.textContent = localized(service.description);
    const detail = document.createElement("div"); detail.className = "service-detail";
    const duration = document.createElement("span"); duration.textContent = service.durationMinutes ? `${service.durationMinutes} ${messages[locale].duration}` : "";
    const price = document.createElement("span");
    price.textContent = service.price?.amount != null && service.price?.currency
      ? new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US").format(service.price.amount) + ` ${service.price.currency}`
      : messages[locale].pricePending;
    detail.append(duration, price);
    card.append(category, title, description, detail); container.append(card);
  });
}

function renderContact() {
  const container = document.querySelector("#contact-details");
  container.replaceChildren();
  const profile = site.businessProfile;
  const entries = [
    ["phone", profile.phone, `tel:${profile.phone.replace(/[^+\d]/g, "")}`],
    ["email", profile.email, `mailto:${profile.email}`],
    ["address", localized(profile.address), null],
    ["social", profile.socialUrl, profile.socialUrl]
  ];
  entries.filter(([, value]) => Boolean(value)).forEach(([key, value, href]) => {
    const row = document.createElement("div");
    const label = document.createElement("span"); label.textContent = messages[locale][key];
    const content = href ? document.createElement("a") : document.createElement("span");
    content.textContent = value;
    if (href) { content.href = href; if (key === "social") { content.target = "_blank"; content.rel = "noopener noreferrer"; } }
    row.append(label, content); container.append(row);
  });
}

document.querySelector("#locale-switch").addEventListener("click", () => setLocale(locale === "fa" ? "en" : "fa"));
document.querySelector("#year").textContent = new Date().getFullYear();

try {
  const response = await fetch(new URL("../content/site.json", import.meta.url));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  site = await response.json();
  setLocale(locale);
} catch (error) {
  document.querySelector("#service-list").textContent = messages[locale].loadError;
  console.error("Kimia site data failed to load", error);
}
