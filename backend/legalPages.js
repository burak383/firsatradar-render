// legalPages.js
// -----------------------------------------------------------------------
// Gizlilik politikasi sayfasi. Google Play Console (ve App Store Connect)
// uygulamayi yayinlamadan once HERKESE ACIK, giris gerektirmeyen bir
// gizlilik politikasi URL'si istiyor -- bu yuzden bunu ayri bir sayfa
// olarak degil, dogrudan bu (zaten canli/public olan) backend'in bir
// route'u olarak sunuyoruz: https://firsatradar-render.onrender.com/privacy
// Boylece Play Console'un otomatik inceleme sistemi (ve herkes) giris
// yapmadan gorebilir.
const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FırsatRadar — Gizlilik Politikası</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 0;
    background: #0B0F17; color: #F4F7FB;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    line-height: 1.65;
  }
  main { max-width: 720px; margin: 0 auto; padding: 40px 20px 80px; }
  h1 { font-size: 26px; margin-bottom: 4px; }
  .updated { color: #9AA8BB; font-size: 13px; margin-bottom: 32px; }
  h2 { font-size: 18px; margin-top: 36px; color: #FF6B00; }
  p, li { color: #E8EDF5; font-size: 15px; }
  ul { padding-left: 20px; }
  a { color: #3BB9FF; }
  .contact {
    margin-top: 40px; padding: 16px 18px; border-radius: 12px;
    background: #111925; border: 1px solid #263247;
  }
</style>
</head>
<body>
<main>
  <h1>FırsatRadar — Gizlilik Politikası</h1>
  <p class="updated">Son güncelleme: 23 Eylül 2026</p>

  <p>
    Bu gizlilik politikası, FırsatRadar mobil uygulamasının (bundan sonra
    "Uygulama") kullanıcılarından hangi verileri, hangi amaçla topladığını
    ve bu verilerin nasıl işlendiğini açıklar. Uygulama, Trendyol,
    Hepsiburada, N11, Çiçeksepeti gibi mağazalardaki indirimleri ve genel
    kanallardaki fırsat duyurularını bir araya getiren, ücretsiz ve
    reklamla desteklenen bir fırsat/indirim takip uygulamasıdır.
  </p>

  <h2>1. Topladığımız veriler</h2>
  <ul>
    <li>
      <strong>Hesap bilgileri (isteğe bağlı):</strong> Uygulamayı hesap
      oluşturmadan da ("misafir" olarak) kullanabilirsiniz. Hesap
      oluşturursanız e-posta adresinizi ve şifrenizi alırız; şifreniz asla
      düz metin olarak saklanmaz, geri döndürülemez şekilde
      (hash'lenerek) saklanır.
    </li>
    <li>
      <strong>Cihaz tanımlayıcısı:</strong> Hesap oluşturmadan kullanırsanız,
      fiyat alarmlarınızı cihazınıza bağlamak için cihazınızda rastgele
      üretilen, kimliğinizi içermeyen bir tanımlayıcı saklanır.
    </li>
    <li>
      <strong>Fiyat alarmı verisi:</strong> Takip etmeyi seçtiğiniz ürünler
      ve belirlediğiniz hedef fiyatlar.
    </li>
    <li>
      <strong>Reklamlar:</strong> Uygulama, reklamları Google AdMob
      aracılığıyla gösterir. Kişiselleştirilmemiş reklam talep ederiz,
      ancak Google'ın reklam sunumu ve dolandırıcılık önleme amacıyla
      cihaz reklam kimliği gibi teknik verileri işlemesi mümkündür. Bu
      veriler Google'ın kendi
      <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">gizlilik politikasına</a>
      tabidir.
    </li>
  </ul>

  <h2>2. Verileri nasıl kullanıyoruz</h2>
  <p>
    Topladığımız veriler yalnızca hesabınızı yönetmek, fiyat alarmlarınızı
    çalıştırmak, size ilgili fırsatları göstermek ve uygulamayı
    geliştirmek için kullanılır. Verileriniz üçüncü taraflara satılmaz.
  </p>

  <h2>3. Veri paylaşımı</h2>
  <p>
    Verileriniz, reklam sunumu için Google AdMob dışında hiçbir üçüncü
    tarafla paylaşılmaz. Sunucularımız Render.com altyapısında barındırılır.
  </p>

  <h2>4. Veri güvenliği ve saklama</h2>
  <p>
    Şifreler geri döndürülemez şekilde hash'lenerek saklanır. Hesap ve
    alarm verileriniz, hesabınızı silene ya da silinmesini talep edene
    kadar sunucularımızda saklanır.
  </p>

  <h2>5. Haklarınız</h2>
  <p>
    Hesabınızın ve ilişkili verilerinizin silinmesini istediğinizde
    aşağıdaki iletişim adresinden bize ulaşabilirsiniz; talebiniz makul
    bir süre içinde yerine getirilir.
  </p>

  <h2>6. Çocukların gizliliği</h2>
  <p>
    Uygulama 13 yaşından küçük kullanıcılara yönelik değildir ve bu yaş
    grubundan bilerek veri toplamayız.
  </p>

  <h2>7. Bu politikadaki değişiklikler</h2>
  <p>
    Bu politikayı zaman zaman güncelleyebiliriz; önemli değişiklikler bu
    sayfada yayınlanır.
  </p>

  <div class="contact">
    <strong>İletişim:</strong><br />
    Sorularınız veya veri silme talepleriniz için:
    <a href="mailto:seolen8@gmail.com">seolen8@gmail.com</a>
  </div>
</main>
</body>
</html>`;

function renderPrivacyPolicy(req, res) {
  res.type('html').send(PRIVACY_HTML);
}

module.exports = { renderPrivacyPolicy };
