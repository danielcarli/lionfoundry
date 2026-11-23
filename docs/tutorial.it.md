# Da zero al primo carattere

[English](tutorial.md) · [Português (Brasil)](tutorial.pt-BR.md) · [Português (Portugal)](tutorial.pt-PT.md) · [Español](tutorial.es.md) · [Français](tutorial.fr.md) · [Deutsch](tutorial.de.md) · **Italiano**

In questo tutorial parti da un progetto vuoto e arrivi a una piccola famiglia pronta da installare: **Regular**, **Bold** e **Italic**, più due stili che LionFoundry calcola da solo tra Regular e Bold.

Non è un corso su come disegnare le lettere. È il percorso dentro l’app: che cosa fare, in quale ordine e dove fare clic. Il disegno è tuo.

> LionFoundry è sperimentale: **salva spesso** (`Ctrl+S`) e conserva delle copie del tuo progetto.

**Prima di iniziare:** premi `?` in qualsiasi momento per vedere tutte le scorciatoie. Le viste sono su `Ctrl+1`–`Ctrl+9`: Font, Glifo, Prova, Features, Famiglia, Verifica, Script, Informazioni, Kerning.

<sub>Le immagini mostrano l’interfaccia in inglese; i nomi usati in questo testo sono quelli dell’interfaccia in italiano. Questa traduzione non è ancora stata rivista da una persona madrelingua.</sub>

## Il percorso

| Parte | Che cosa fai |
|---|---|
| [Gli strumenti](#tools) | Conosci la penna, la selezione, la scala e il pannello |
| [1. Il progetto](#step-1) | Crealo, salvalo, imposta le altezze |
| [2. Le prime lettere](#step-2) | Disegna `n`, `o`, `H`, `O` |
| [3. Il resto dell’alfabeto](#step-3) | Ricava le altre lettere dalle prime |
| [4. La spaziatura](#step-4) | Regola i margini laterali leggendo il testo |
| [5. Gli accenti](#step-5) | Costruisci le lettere accentate |
| [6. Il kerning](#step-6) | Sistema le coppie che restano |
| [7. Il Bold](#step-7) | Aggiungi il secondo peso e i pesi intermedi |
| [8. L’Italic](#step-8) | Aggiungi il corsivo a partire dal Regular |
| [9. Verifica](#step-9) | Leggi l’elenco dei problemi |
| [10. Esporta](#step-10) | Genera tutti i font in una volta |

## Parole che vedrai

| Parola | Che cos’è |
|---|---|
| **Glifo** | Il disegno di un carattere. La lettera `a` è un glifo; `á` è un altro. |
| **Contorno** | La linea chiusa che forma il disegno. La `o` ne ha due: quello esterno e quello interno. |
| **Punto e maniglia** | Il punto sta sulla linea. Le maniglie escono dal punto e dicono come si piega la curva. |
| **Margini laterali** | Lo spazio bianco a sinistra e a destra di ogni lettera. |
| **Kerning** | Una modifica dello spazio per una sola coppia di lettere, come `AV`. |
| **Master** | Uno stile che disegni: Regular, Bold, Italic. |
| **Istanza** | Uno stile che l’app calcola tra due master: Medium, SemiBold. |
| **Ancora** | Un punto con un nome che dice dove si posa un accento su una lettera. |

<a id="tools"></a>

## Gli strumenti

Quasi tutto il disegno avviene nella vista **Glifo** (`Ctrl+2`). Questa è la sua barra degli strumenti:

<div align="center">
<img src="screenshots/tutorial-toolbar.png" alt="La barra degli strumenti della vista Glifo, con un numero su ogni pulsante" width="900">
</div>

**Per disegnare**

| N. | Strumento | Tasto | A che cosa serve |
|---|---|---|---|
| 2 | **Testo** | `T` | Digitare per mettere lettere nella riga. La lettera dopo il cursore è quella che i tasti cambiano (passo 4). `Esc` torna a disegnarla. |
| 3 | **Selezione** | `V` | Fai clic su un punto, trascina un riquadro per prenderne diversi, trascina per spostare. Le frecce spostano di 1 unità; con `Maiusc`, di 10. `Canc` rimuove. |
| 4 | **Penna** | `P` | Disegna. Clic: un punto retto. Clic e trascina: un punto di curva. Clic sul primo punto: la forma si chiude. |
| 5 | **Scala** | `S` | Ingrandisce o riduce ciò che è selezionato. Trascina; `Maiusc` mantiene le proporzioni. |
| 6 | **Aggiungi punto** | `+` | Fai clic sulla linea e lì compare un punto. La forma non cambia. |
| 7 | **Rimuovi punto** | `−` | Fai clic su un punto e sparisce. La curva resta il più simile possibile. |
| 8 | **Coltello** | `E` | Trascina una linea attraverso le forme: vengono tagliate in parti chiuse. |
| 9 | **Rettangolo** / **Ellisse** | `F` | Trascina da un angolo all’altro per disegnare un rettangolo; `F` di nuovo passa all’ellisse. `Maiusc`: quadrato o cerchio. |
| 10 | **Ruota** | `R` | Ruota la selezione attorno al suo centro (fai clic per scegliere un altro punto). `Maiusc`: a passi di 15°. |
| 11 | **Righello** | `L` | Trascina una linea: mostra lunghezza, angolo e spessore di ogni tratto che attraversa. |
| 12 | **Aggancia** | `M` | (la calamita) Attira ciò che trascini sulle linee delle altezze e sulle guide. `Alt` lo lascia libero per un movimento. |

**Per vedere**

| N. | Pulsante | Che cosa mostra o nasconde |
|---|---|---|
| 1 | Frecce | Glifo precedente e successivo (anche `[` e `]`) |
| 13 | Riempimento | La lettera riempita, come apparirà in un testo |
| 14 | Punti | I punti e le maniglie |
| 15 | Metriche | Le linee delle altezze e la larghezza della lettera |
| 16 | Ancore | I punti in cui si posano gli accenti |
| 17 | Guide | Le tue linee di aiuto |
| 18 | Sfondo | La copia del disegno tenuta dietro, per confrontare o ricalcare |
| 19 | Zoom | Ingrandisci e riduci (anche con la rotellina del mouse, o `Ctrl` `+` e `Ctrl` `−`) |
| 20 | Adatta | Mostra l’intero glifo (`Ctrl+0`). `Spazio` + trascinamento sposta la vista. |

Quando il progetto ha più di un master compare un pulsante in più, **Altri master**: mostra l’altro peso dietro quello che stai disegnando.

**Il pannello a destra** contiene il resto: la larghezza e i margini laterali (**Metriche**), ciò che è selezionato, **Trasforma** (sposta, scala, ruota, inclina e rifletti con i numeri), i componenti, le ancore e **Guide**.

**Il riquadro di scala.** Con due o più punti selezionati compare un riquadro intorno a loro. Trascina un angolo per ingrandire o ridurre la forma. `Maiusc` mantiene le proporzioni; `Alt` scala dal centro.

<div align="center">
<img src="screenshots/tutorial-scale.png" alt="Due cerchi selezionati, con il riquadro di scala intorno" width="640">
</div>

**Un errore?** `Ctrl+Z` annulla qualsiasi cosa.

<a id="step-1"></a>

## 1. Il progetto

1. **`Ctrl+N`** (Nuovo progetto…). Digita il nome della famiglia e lascia **1000** unità per em. Il progetto parte con glifi vuoti per A–Z, a–z e le cifre.
2. **`Ctrl+Maiusc+S`** (Salva con nome…) e scegli dove salvare. Il progetto è una cartella `.ufo`.
3. In **Informazioni** (`Ctrl+8`), controlla le altezze. Un buon punto di partenza per un carattere da testo:

| Linea | Valore |
|---|---|
| Ascendente | 740 |
| Altezza delle maiuscole | 700 |
| Altezza della x | 500 |
| Discendente | −220 |

Queste linee compaiono in ogni glifo e trattengono i tuoi punti quando **Aggancia** è attivo (tasto `M`).

<a id="step-2"></a>

## 2. Le prime lettere

Comincia da quattro lettere. Decidono quasi tutto: `n` e `o` definiscono le minuscole, `H` e `O` le maiuscole.

Nella vista **Font** (`Ctrl+1`), fai doppio clic su `n` per aprirla nella vista **Glifo**.

<div align="center">
<img src="screenshots/glyph-daca.png" alt="La vista Glifo con una lettera in modifica" width="820">
</div>

Prendi lo strumento **Penna** (`P`) e disegna la forma, punto per punto. Poi passa a **Selezione** (`V`) e sistema.

**Quattro abitudini che fanno risparmiare lavoro più avanti**

- **Punti agli estremi.** In una curva, metti i punti in alto, in basso e ai lati — non a metà della diagonale.
- **Maniglie dritte.** Tieni premuto `Maiusc` mentre trascini una maniglia, oppure usa `Maiusc+H` e `Maiusc+V`, per renderla orizzontale o verticale.
- **Le lettere tonde superano la linea.** La `o` e la `O` scendono di circa 10 unità sotto la linea di base e salgono altrettanto sopra l’altezza, altrimenti sembrano più piccole di `n` e `H`.
- **Annota lo spessore.** Misura l’asta della `n` (diciamo 80 unità) e usa lo stesso valore nelle altre lettere.

Nel pannello, sotto **Metriche**, digita **Margine sinistro** e **Margine destro**. Per ora bastano valori approssimativi: 60 per i lati dritti, 30 per i lati tondi.

Ti serve un’altra linea? Sotto **Guide**, nel pannello, aggiungi una guida orizzontale, verticale o diagonale e trascinala al suo posto.

<div align="center">
<img src="screenshots/guides-daca.png" alt="Guide in un glifo, con punti agganciati a esse" width="820">
</div>

**Costruire con le forme.** Alcune lettere si fanno prima a pezzi: un'asta con il **Rettangolo** (`F`), una pancia con l'**Ellisse** (`F` di nuovo). Lasciale sovrapporre e premi **Rimuovi sovrapposizione** (`Ctrl+Maiusc+O`): diventano un solo contorno, e le curve restano curve. Il **Coltello** (`E`) taglia una forma in due; con dei contorni selezionati, **Unisci**, **Sottrai** e **Interseca** le combinano. **Aggiungi estremi** mette i punti agli estremi per te, e **Riordina contorni** (`Ctrl+Maiusc+T`) toglie i punti che avanzano.

**Misurare e confrontare.** Il **Righello** (`L`) mostra lo spessore di ogni tratto che attraversa: un modo rapido per tenere uguali le aste. Prima di un grande cambiamento, **Copia nello sfondo** (pannello) tiene il vecchio disegno dietro il nuovo; **Scambia con lo sfondo** lo riporta davanti. `Tab` passa da un punto all’altro, `Ctrl+Maiusc+A` mette i punti selezionati su una linea, e `Alt` + trascina disegna un lazo attorno ai punti.

<a id="step-3"></a>

## 3. Il resto dell’alfabeto

Non disegnare ogni lettera da zero. Copia e adatta.

1. Nel glifo di partenza, senza nulla selezionato, **`Ctrl+C`** copia l’intero disegno.
2. Apri il glifo di destinazione (`[` e `]` vanno al precedente e al successivo) e premi **`Ctrl+V`**.
3. Cambia ciò che va cambiato.

| Da | Ottieni |
|---|---|
| `n` | `h`, `m`, `r` e la `u` (la `n` capovolta: nel pannello, sotto Trasforma, digita 180 e fai clic su Ruota) |
| `o` | `c`, `e`; con un’asta: `b`, `d`, `p`, `q` |
| `H` | `E`, `F`, `L`, `T`, `I` |
| `O` | `C`, `G`, `Q`, `D` |

Per ingrandire o ridurre una parte, seleziona i suoi punti e usa il **riquadro di scala**.

Dopo aver incollato o ruotato, fai clic su **Correggi direzione** nel pannello: mette tutti i contorni nel verso giusto in una volta.

<a id="step-4"></a>

## 4. La spaziatura

La spaziatura si regola leggendo, non misurando. Apri la vista **Prova** (`Ctrl+3`).

1. Digita `nnnonnnoonoo`, poi `HHHOHHHOOHOO`. Il pulsante **Spaziatura** offre testi già pronti.
2. **Fai clic su una lettera** nel testo: compaiono i suoi margini laterali e la sua larghezza. Cambiali e guarda il testo seguirli.
3. Sistema prima `n` e `o`, finché il ritmo è regolare. Poi dai a ogni lettera i margini della forma a cui somiglia: lati dritti come `n`, lati tondi come `o`.

<div align="center">
<img src="screenshots/proof-daca.png" alt="La prova, con i margini laterali e il kerning della lettera su cui si è fatto clic" width="820">
</div>

**Spaziare dove disegni.** Lo stesso funziona nella vista **Glifo**: digita la parola nel suo campo **Testo**, premi `T` e metti il cursore prima di una lettera. `Alt + ← →` cambiano il suo margine sinistro, `Ctrl + ← →` quello destro, `Ctrl+Alt + ← →` il suo kerning con la lettera precedente; con `Maiusc`, 10 unità alla volta. `Esc` torna a disegnare quella lettera.

<a id="step-5"></a>

## 5. Gli accenti

Le lettere accentate si costruiscono, non si disegnano.

1. **Fai gli accenti.** Nella vista Font, **Nuovo glifo**. Lascia vuoto il carattere e digita il nome: `acute`, `grave`, `circumflex`, `tilde` e `cedilla`. Disegnali uno per uno.
2. **Segna dove si posano.** In ogni lettera che prende un accento, nel pannello, **Aggiungi ancora…** con il nome `top`, appena sopra la lettera. In ogni accento, un’ancora chiamata `_top` sotto di esso. L’app unisce il `_top` dell’accento al `top` della lettera. Per la cediglia, usa `bottom` nella `c` e `_bottom` nella cediglia.
3. **Costruisci.** Nel menu delle azioni della vista Font, **Aggiungi i glifi di una lingua…** e scegli **Portoghese** — gli accenti disegnati qui sopra sono quelli del portoghese. **Europa occidentale** copre anche l’italiano e richiede qualche accento in più, come la dieresi (`dieresis`). Le lettere accentate si costruiscono da sole. Ciò che non si può costruire viene creato vuoto, da disegnare.

Hai cambiato la `a`? `á`, `ã` e `â` cambiano con lei, perché usano la `a` come componente.

<a id="step-6"></a>

## 6. Il kerning

Il kerning serve per le coppie che la spaziatura non riesce a risolvere: `AV`, `To`, `LT`, `r.`. Fallo **dopo** la spaziatura.

1. Nella vista **Kerning** (`Ctrl+9`), crea dei **gruppi** con **Nuovo gruppo…**: le lettere che si comportano allo stesso modo su un lato condividono un gruppo. Per esempio, `O Q D` come primo glifo della coppia; `O C G Q` come secondo. Una coppia fatta con il gruppo vale per tutte.
2. Nella vista **Prova**, pulsante **Kerning**: fai clic sulla seconda lettera di una coppia e cambia il suo **kerning** con la lettera che la precede.

<div align="center">
<img src="screenshots/kerning-daca.png" alt="La vista Kerning: i gruppi per ogni lato della coppia e l’elenco delle coppie" width="820">
</div>

Poche coppie ben scelte valgono più di centinaia. Se ci sono molte coppie da sistemare, il problema è nella spaziatura.

<a id="step-7"></a>

## 7. Il Bold

Un **master** è uno stile che disegni. Finora ne hai uno: il Regular.

1. Vista **Famiglia** (`Ctrl+5`) › **Nuovo master…**. Posizione **700**, nome **Bold**.
2. Il Bold inizia come **copia del Regular** e diventa il master in modifica. Nella barra laterale compaiono due pulsanti, Regular e Bold: è lì che passi dall’uno all’altro.
3. Apri una lettera e attiva **Altri master** nella barra degli strumenti: il Regular appare dietro.
4. Rendila più pesante. **Sposta i punti; non aggiungerne e non toglierne.** Seleziona i punti su un lato di un’asta e spingili con le frecce; nelle curve, sposta il punto e le sue maniglie lo seguono.

<div align="center">
<img src="screenshots/weights-daca.png" alt="Un glifo del Bold con il Regular dietro, e il pannello di compatibilità" width="820">
</div>

**Perché gli stessi punti?** Per calcolare un peso intermedio, l’app collega ogni punto del Regular allo stesso punto del Bold. Se un lato ha un punto in più, non può farlo. Il pannello indica, sotto **Compatibilità tra master**, se il glifo è a posto. Se è sbagliato solo l’ordine, **Correggi compatibilità** lo sistema senza cambiare la forma.

Se mancano dei punti, **Aggiungi i punti mancanti** dà a ogni master i punti che ha l’altro, nello stesso posto, senza cambiare la forma. Per vedere dove differiscono, attiva **Compatibilità**: i punti ricevono un numero, una linea tratteggiata va allo stesso punto dell’altro master e un anello rosso segna ciò che non ha corrispondenza. **Tutti i master** mostra la lettera in ogni master sotto la riga, e **Anteprima** la parola a qualsiasi peso intermedio. Tieni premuto `Alt` mentre aggiungi o rimuovi un punto per farlo in tutti i master.

Nel Bold: le aste da 80 diventano circa 140; gli spazi interni si riducono; i margini laterali si riducono un po’. Controlla di nuovo la spaziatura e il kerning nella prova — ogni master ha i propri.

**Le istanze.** Nella vista Famiglia, sotto **Tra i master**, trascina il cursore fino a **500** e fai clic su **Aggiungi questa posizione come istanza…** (Medium). Fai lo stesso a **600** (SemiBold). Non vengono disegnate: vengono ricalcolate a ogni esportazione e seguono ogni modifica al Regular e al Bold.

<div align="center">
<img src="screenshots/family-daca.png" alt="La vista Famiglia con i master, il cursore tra di loro e tutti gli stili nello stesso testo" width="820">
</div>

<a id="step-8"></a>

## 8. L’Italic

1. Nella barra laterale, torna al **Regular**.
2. Vista Famiglia › **Nuovo corsivo da questo master…**. Inclinazione **10** gradi, nome **Italic**.
3. Il corsivo inizia come il Regular **inclinato** — un obliquo, con gli stessi punti. Il vero lavoro comincia adesso.

**Che cosa ridisegnare**

- **Le curve.** L’inclinazione deforma le lettere tonde: la `o` si ritrova con un lato pesante. Riequilibra punti e maniglie.
- **Le forme tipiche del corsivo.** La `a` a un solo piano, una `e` più tonda, una `f` che scende sotto la linea di base, uscite curve su `n`, `m`, `u`.
- **La larghezza.** I corsivi sono di solito un po’ più stretti. Seleziona tutto (`Ctrl+A`) e usa la maniglia laterale del riquadro di scala.
- **La spaziatura e il kerning**, di nuovo nella prova.

Tondi e corsivi sono due gruppi: le istanze si calcolano solo all’interno di ciascuno. Con un solo corsivo non ci sono istanze corsive. Per un Bold Italic, ripeti il passaggio 2 partendo dal Bold.

<a id="step-9"></a>

## 9. Verifica

Vista **Verifica** (`Ctrl+6`).

- **Guida del progetto**: ciò che è fatto e ciò che manca.
- **Le lingue**, subito sotto la guida: quanto di ciascuna il font scrive già. **Aggiungi glifi…** accanto a una lingua crea ciò che manca.
- **Problemi**: ogni voce ti porta al glifo. Correggi gli errori; leggi gli avvisi. I glifi che non si possono interpolare sono elencati qui.

<div align="center">
<img src="screenshots/check-daca.png" alt="La vista Verifica: guida del progetto, copertura e problemi" width="820">
</div>

Verifica ogni master: cambia nella barra laterale e guarda di nuovo l’elenco.

<a id="step-10"></a>

## 10. Esporta

1. **`Ctrl+E`** (oppure il pulsante **Esporta** nella barra laterale).
2. Sotto **Che cosa**, scegli **Tutta la famiglia**. Spunta **Font TrueType (.ttf)** e **Font web (.woff2)**.
3. Scegli dove creare la cartella.

<div align="center">
<img src="screenshots/export-daca.png" alt="La finestra Esporta" width="520">
</div>

Ottieni una nuova cartella con:

| Cartella o file | A che cosa serve |
|---|---|
| `ttf/` | Da installare su un computer: Regular, Italic, Medium, SemiBold, Bold |
| `woff2/` | Da usare sui siti web |
| `.css` | Le regole `@font-face`, già pronte |

Installa i font da `ttf/` e scrivi un testo vero in un altro programma. I pulsanti Grassetto e Corsivo dovrebbero trovare il Bold e l’Italic. Hai trovato un difetto? Torna al progetto, correggilo ed esporta di nuovo: ogni esportazione crea un’altra cartella e non sovrascrive mai nulla.

<div align="center">
<img src="screenshots/exported-family.png" alt="Una famiglia esportata da LionFoundry, composta in un testo" width="640">
</div>

## E poi?

- **Cifre e punteggiatura**: lo stesso percorso delle lettere.
- **Legature**: crea un glifo chiamato `f_i` e la legatura funziona da sola (vista **Features**).
- **Maiuscoletti e alternative**: i glifi chiamati `a.sc` o `a.ss01` diventano feature grazie al nome.
- **Bold Italic**: un corsivo fatto a partire dal Bold.

**Che cosa LionFoundry non fa ancora per te:** non applica l’hinting ai font (vanno bene in stampa, sul web e sugli schermi ad alta densità; morbidi nei corpi piccoli sui vecchi schermi Windows), non esporta font variabili, non aggiunge i punti che mancano tra due master e non salva da solo. L’elenco completo è nel [README](../README.it.md#where-it-stands).
