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

**Autot:** BMW M5 E39 (ilmainen), Mercedes-AMG GT R, Porsche 911 GT3,
Red Bull RB19 ja Bugatti Chiron. Jokaisella oma vääntökäyrä, välitykset,
painojakauma ja ohjauskulma.

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

Arvot on mitattu simuloimalla: BMW M5 kiihtyy nollasta sataan 7,7 sekunnissa ja
kulkee 284 km/h. Tallin lukemat eivät ole arvioita vaan ajetaan samalla
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
| `C` | Kamera |
| `R` | Palauta radalle |
| `Esc` | Tauko |

Peliohjain toimii suoraan (liipaisimet, olkanapit), samoin kosketusnäyttö.

## Tekninen rakenne

```
drift/
  index.html         käyttöliittymän runko
  style.css          ulkoasu
  vendor/            Three.js (paketoitu, ei CDN-riippuvuutta)
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
    ui.js            valikot, talli, asetukset
    save.js          tallennus localStorageen
```

Edistyminen tallentuu vain selaimen localStorageen; mitään ei lähetetä
palvelimelle.

## Huomio nimistä

Autot on nimetty oikeiden mallien mukaan. Merkit ja mallinimet ovat
tavaramerkkejä, eikä pelillä ole valmistajien lupaa - jos peli julkaistaan
laajemmin, nimet kannattaa harkita uudelleen.
