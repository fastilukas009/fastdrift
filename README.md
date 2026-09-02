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
(`T`). Ero on mitattu: 35 % ohjausta ja täysi kaasu antaa driftirenkailla 89
asteen kulman ja vauhti romahtaa, kisarenkailla auto pysyy 4,5 asteessa ja
kiihtyy 189 km/h:iin. Vaihto lyö kesken olevan sarjan lukkoon, joten
kisarenkaille ei voi vaihtaa juuri ennen pisteiden korjaamista.

**Los Angeles:** avoin kaupunki, jossa saa ajaa vapaasti. Ruutukaava
palmubulevardeineen, korttelit rakennuksineen, suojatiet ja liikennevalot.
Kadulla on 64 siviiliautoa, jotka ajavat omalla kaistallaan, pitävät etäisyyttä
edellä ajavaan, näyttävät vilkkua, pysähtyvät punaisiin ja väistävät pelaajaa,
sekä 150 jalankulkijaa jotka kävelevät jalkakäytäviä ja pakenevat kun auto
tulee päälle. Ohilipaisu siviiliautosta antaa bonuspisteet - osuma vie sarjan.

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

Arvot on mitattu simuloimalla: Aurum S550 kiihtyy nollasta sataan 7,7 sekunnissa
ja kulkee 284 km/h. Tallin lukemat eivät ole arvioita vaan ajetaan samalla
fysiikalla kuin itse peli.

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
    walls.js         seinien törmäys ja geometria
    postfx.js        hehku, värikorjaus, nopeussumennus
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
