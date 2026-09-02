# Fastidrift

Selaimessa pyörivä driftipeli osoitteessa `/drift/`. Ei latauksia, ei asennusta,
ei ulkoisia riippuvuuksia ajon aikana - Three.js on paketoitu mukaan ja kaikki
tekstuurit, automallit ja äänet generoidaan koodista.

## Pelin idea

Aja kulmia, kerää pisteitä, osta parempi auto. Pisteet kertyvät sarjan aikana
"pankkiin" ja lyödään lukkoon vasta kun oikaiset. Seinään ajo tai spinni vie
keräämättömät pisteet - riski vastaan palkkio on koko pelin ydin.

Pisteitä tuottavat:

- **kulma kertaa nopeus** - jyrkkä kulma kovassa vauhdissa maksaa eniten
- **kerroin** joka kasvaa sarjan pituuden mukaan (x1 - x10)
- **suunnanvaihdot** kesken sarjan
- **klipsipisteet** (keltaiset renkaat) joiden läpi ajetaan driftissä
- **seinän vieressä** ajaminen kapeilla radoilla

## Sisältö

**Autot:** Aurum S550 (ilmainen supersedan), Sturmwind GT (etumoottorinen
V8-kupee), Falke 900 RS (takamoottori), Apex F-01 (avopyöräinen formula) ja
Chimera W16 (hyperauto). Nimet ja mallit ovat omia; muotoilu on tunnistettavaa
autotyyppiä, ei minkään valmistajan kopio. Jokaisella oma vääntökäyrä,
välitykset, painojakauma ja ohjauskulma.

**Renkaat:** kesken ajon voi vaihtaa driftirenkaiden ja kisarenkaiden välillä
(`T`). Vaihto lyö kesken olevan sarjan lukkoon, joten kisarenkaille ei voi
vaihtaa juuri ennen pisteiden korjaamista.

Kisarenkaat eivät ole "enemmän kitkaa" vaan eri ajoneuvo. Pelkkä korkeampi
kitkakerroin ei estä driftiä - riittävällä kaasulla ja käsijarrulla mikä tahansa
rengas irtoaa - joten pidossa on kolme asiaa yhdessä: rengas ei menetä pitoaan
kyllästyessään, taka pitää selvästi etua enemmän, ja päällä on elektroniikka
joka leikkaa vääntöä, vaimentaa sivuluistoa ja estää myös käsijarrua
lukitsemasta takarenkaita. Kolmas kohta on se joka oikeasti ratkaisee.

Mitattu kolmella eri driftitavalla (kaasu ja ratti, käsijarru-aloitus,
kytkinpotku) kahdella autolla:

| | suurin kulma | aikaa yli 20 asteen | huippunopeus |
| --- | --- | --- | --- |
| DRIFT | 90° | 3,3 - 6,3 s | 37 - 62 km/h |
| PITO | 4 - 7° | 0,0 s | 140 - 262 km/h |

Driftirengas on entisen driftin ja entisen pidon puoliväli. PD-säädin
("kokenut kuljettaja") pitää sillä 26 - 33 asteen kulmaa 15 - 17 sekuntia
neljällä autolla viidestä ilman spinniä; ennen kulma oli 30 - 38 astetta.

**Los Angeles:** avoin kaupunki, jossa saa ajaa vapaasti. Ruutukaava
palmubulevardeineen, korttelit rakennuksineen, suojatiet ja liikennevalot.
Kadulla on 64 siviiliautoa, jotka ajavat omalla kaistallaan, pitävät etäisyyttä
edellä ajavaan, näyttävät vilkkua, pysähtyvät punaisiin ja väistävät pelaajaa,
sekä 150 jalankulkijaa jotka kävelevät jalkakäytäviä ja pakenevat kun auto
tulee päälle. Ohilipaisu siviiliautosta antaa bonuspisteet - osuma vie sarjan.

**Lentokenttä ja moottoritie:** kaupungin länsipuolella on 800 metrin kiitorata
rullausteineen, asematasoineen, halleineen ja terminaaleineen, ja etelässä
kulkee kolmikaistainen moottoritie kaiteiden välissä. Kummallekin pääsee
kaupungista katuja pitkin - lentokentälle tulotietä, moottoritielle rampin
kautta. Siviililiikennettä näillä alueilla ei ole: ne ovat avointa tilaa.

**Radat:** Satamalaituri (avoin harjoituskenttä), Teollisuusrata (aika-ajo),
Vuoristolasku (kapea alamäki hämärässä) ja Talviratapiha (yö, lumi, puolet
pidosta).

**Talli:** kahdeksan osaluokkaa (moottori, ahdin, renkaat, alusta, kulmasarja,
kevennys, jarrut, tasauspyörästö), vapaat säädöt sekä maalaamo.

## Fysiikka

Ajoneuvo on tasossa liikkuva jäykkä kappale, jota simuloidaan 250 Hz:n
aliaskelilla:

- **Rengasmalli** yhdistetylle luistolle: pitkittäis- ja sivuttaisluisto
  normalisoidaan omilla huippuarvoillaan, ja voima haetaan yhdeltä käyrältä
  luistovektorin pituuden mukaan. Kylläisenä renkaalle jää noin 74 % pidosta -
  juuri se luku ratkaisee, onko drifti hallittava.
- **Kuormansiirto** pituus- ja sivusuunnassa, kallistusjako säädettävissä.
- **Voimansiirto**: vääntökäyrä, välitykset, kytkin (kytkinpotku toimii),
  kierrosrajoitin ja luistonestollinen tasauspyörästö.
- **Alusta**: kitka, korkeus ja kaltevuus näytteistetään radan ruudukosta,
  joten alamäki oikeasti vetää autoa eteenpäin.
- **Törmäys** tarkistetaan jokaisen fysiikan aliaskeleen jälkeen, ei kerran
  ruudussa. Siksi auto ei livahda seinän läpi vaikka ruudunpäivitys sakkaisi.

Ohjauksen merkistä: oikeakätisessä Y-ylös -koordinaatistossa +Z:aan katsovan
kappaleen paikallinen +X osoittaa sen vasemmalle. Fysiikka on johdonmukainen
tässä kehyksessä ja peilisymmetrinen, joten pelaajan ohjaus käännetään kerran
`vehicle.js`:n `step()`-metodissa. Älä kumoa sitä käymättä koko kehystä läpi.

Arvot on mitattu simuloimalla. Tallin lukemat eivät ole arvioita vaan ajetaan
samalla fysiikalla kuin itse peli.

Seinät testataan pakoyrityksillä: neljältä radalta 24 lähtöpistettä, viisi
suuntaa, 45 m/s ja täysi kaasu kuuden sekunnin ajan. 480 yritystä, 0 karkuria.
Ilman tätä testiä ei olisi löytynyt sitä, että tien reunaseinien sisäänpäin
osoittava normaali osoitti ulos: törmäys työnsi auton radalta ulos seinän läpi,
39 metrin päähän keskilinjasta.

## Ohjaus

| Näppäin | Toiminto |
| --- | --- |
| `W` / `↑` | Kaasu |
| `S` / `↓` | Jarru, paikallaan peruutus |
| `A` `D` | Ohjaus |
| `Väli` | Käsijarru |
| `Shift` | Kytkin |
| `Q` `E` | Vaihteet manuaalilla |
| `T` | Renkaat: drift / kisapito |
| `M` | Kartta: lähikuva / koko kartta |
| `C` | Kamera |
| `R` | Palauta radalle |
| `Esc` | Tauko |

Peliohjain toimii suoraan (liipaisimet, olkanapit), samoin kosketusnäyttö.

## Kaupunki ja liikenne

Kadut ovat akselien suuntaisia, joten ajopinta lasketaan analyyttisesti eikä
rasteroimalla ruudukkoon kuten kilparadoilla: kaupunki voi olla kilometrin
levyinen ilman muistiongelmia, ja kitkan raja on tarkka pikselin sijaan metrin
tarkkuudella.

Siviiliauto kulkee aina jotakin polkua: joko suoraa kaistaa risteysten välissä
tai Bezier-kaarta risteyksen läpi. Nopeuteen vaikuttaa neljä asiaa - nopeus-
rajoitus, edellä ajava, risteyksen valo ja pelaajan auto.

Etäisyydenpito noudattaa neliojuurilakia: tavoitenopeus on se, jolla auto ehtii
vielä pysähtyä kiihtyvyydella 6 m/s^2 ennen kuin väli loppuu. Lineaarinen
profiili näytti samalta mutta vaati kaukana enemmän jarrutusta kuin autolla oli
käytettävissä, ja kaukana harvemmin päivittyvä auto ajoi edellä ajavan läpi.
Lisäksi matkaa ei koskaan oteta enempää kuin väliä on jäljellä, joten läpiajo on
mahdotonta myös nelinkertaisella aika-askeleella.

Mitattu 90 sekunnin ajolla 64 autolla ja 150 kävelijällä: yksikään auto ei ajanut
kadulta ulos, yksikään ei mennyt risteykseen punaisella (43 sisäänajoa, kaikki
vihreällä), päällekkäisyyksiä oli 0,03 % näytteistä, eikä yksikään kävelijä
päätynyt rakennuksen sisään tai ajoradalle. Koko tekoäly maksaa 0,50 ms
ruudussa - kolme prosenttia 60 FPS:n budjetista.

Kaikki agentit ovat kiinteä altaa, joka kierrätetään pelaajan ympärille: ajon
aikana ei varata muistia, joten roskienkeruu ei nykäise. Autot kierrätetään 240
metrin ja kävelijät 150 metrin säteellä - kävelijä kulkee 1,4 m/s eikä ehtisi
koskaan takaisin kuvaan kauempaa. Piirto menee neljänä instansoituna kutsuna.

## Minikartta

Vasemmassa alakulmassa on kartta, jossa näkyvät kadut, korttelit, lentokenttä,
moottoritie ja lähin siviililiikenne. `M` avaa koko kaupungin kartan.

Kartta on pohjoinen ylöspäin, ei ajosuunta ylöspäin. Ruutukaavassa se on ainoa
järkevä valinta: kääntyvä kartta tekee suorakulmaisesta verkosta vinon eikä
kortteleita tunnista enää mistään. Pelaajan nuoli kääntyy, kartta ei.

Kilparadalla kartta näyttää koko radan kerralla - kierrosajossa se on
hyödyllisempi kuin 260 metrin ikkuna. Kaupunki on kilometrin levyinen, joten se
katsotaan aina läheltä.

Tausta ei muutu ajon aikana, joten se piirretään kerran radan vaihtuessa isolle
kankaalle. Ruutukohtainen työ on yksi `drawImage` ja kourallinen pisteitä, ei
satojen katujen uudelleenpiirto.

## Grafiikka

Renderöinti menee jälkikäsittelypinon läpi: `RenderPass` -> hehku -> sävykartoitus
-> värikorjaus. Hehku lasketaan lineaarisessa HDR-tilassa kynnyksellä 1.0, joten
vain aidot valonlähteet hehkuvat eikä koko kuva sumene. Värikorjaus tekee
vinjetin, kylläisyyden, kontrastin ja nopeussumennuksen, joka alkaa 90 km/h:ssa
ja venyttää ruudun reunoja kohti keskustaa.

Auringon varjokamera seuraa autoa tiukalla 44 metrin rajauksella, joten sama
varjokartta antaa terävän reunan juuri siellä missä pelaaja katsoo. Taivas ja
ympäristökartta johdetaan samasta 2048x1024 canvas-kuvasta, joten maalipinta
heijastaa täsmälleen sitä taivasta joka ruudulla näkyy.

## Tekninen rakenne

```
drift/
  index.html         käyttöliittymän runko
  style.css          ulkoasu
  vendor/            Three.js ja jälkikäsittely (paketoitu, ei CDN-riippuvuutta)
  js/
    main.js          renderöinti, kamerat, ajologiikka, mittaristo
    vehicle.js       ajoneuvofysiikka
    cars.js          autokatalogi, osat ja niistä johdettu speksi
    tracks.js        ratageometria, pinnan näytteistys, törmäykset
    carmodel.js      auton 3D-malli poikkileikkauksista
    scoring.js       driftin pisteytys
    fx.js            savu, jarrutusjäljet, kipinät, sää
    audio.js         moottori- ja rengasäänet WebAudiolla
    input.js         näppäimistö, peliohjain, kosketus
    city.js          avoin kaupunki: kaava, kadut, korttelit, rakennukset
    latraffic.js     siviililiikenteen ja jalankulkijoiden tekoäly
    districts.js     lentokenttä ja moottoritie
    walls.js         seinien törmäys ja geometria
    postfx.js        hehku, värikorjaus, nopeussumennus
    minimap.js       minikartta
    ui.js            valikot, talli, asetukset
    save.js          tallennus localStorageen
```

Edistyminen tallentuu vain selaimen localStorageen; mitään ei lähetetä
palvelimelle.

## Ääni

Moottori on ristikampi-V8. Sen tunnistaa kahdesta asiasta, ja molemmat on
mallinnettu suoraan: puolikkaista kertaluvuista (0.5x ja 1.5x sytytys-
taajuudesta) ja kierroskohtaisesta loikasta, joka syntyy kun pankit eivät syty
tasavälein. Loikka on voimakkaimmillaan tyhjäkäynnillä ja häviää kierrosten
noustessa. Pakoputken resonanssi 90-150 Hz:ssä antaa matalan möyryn.

## Suorituskyky

Peli ei tiedä etukäteen mille raudalle se päätyy, joten se mittaa itse. Jos
ruudunpäivitys jää alle 45:n yhtäjaksoisesti neljäksi sekunniksi, grafiikka-
asetus putoaa askeleen ja ruudulle tulee ilmoitus. Ylös ei nostella
automaattisesti - se heiluisi edestakaisin juuri rajan tuntumassa - ja jos
pelaaja valitsee laadun itse, automatiikka ei enää puutu asiaan.

Asetus säätää kolmea asiaa: piirtotarkkuutta (pikselisuhteen katto 1 / 1,35 /
2), varjokartan kokoa ja jälkikäsittelyä. Raskain niistä on piirtotarkkuus:
tarkalla näytöllä pikselisuhde 2 tarkoittaa nelinkertaista pikselimäärää, ja
sen päälle tulee vielä hehkuketju.

Geometriaa on radoittain 12 000 - 88 000 kolmiota ja 96 - 146 piirtokutsua.
