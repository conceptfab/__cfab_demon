# Lista Błędów ze zrzutów ekranu

## 1. Ucięte menu kontekstowe na osi aktywności (Błąd UI)

**Plik:** `dashboard/src/components/dashboard/ProjectDayTimeline.tsx` lub powiązany widżet traya

**Opis problemu:**
Menu kontekstowe wywoływane dla segmentu sesji ("Session actions (Plasticity-beta)") nie mieści się w widoku z powodu braku wystarczającej ilości miejsca w dół od miejsca kliknięcia. Dół okienka z dostępnymi akcjami ucina się na krawędzi okienka lub ekranu. Problem występuje szczególnie wtedy, gdy wywoływany element (ostatnia pozycja na liście) znajduje się przy samej dolnej krawędzi ekranu, blokując użytkownikowi wgląd i możliwość interakcji z ukrytą częścią menu.

**Sugerowane rozwiązanie:**
Zaimplementować logiczne pozycjonowanie menu na ekranie, by w przypadku braku miejsca w dole ekranu/obszaru (`window.innerHeight`), wysuwało się ono w górę zamiast w dół, albo zastosować komponent typu tooltip/popover z automatycznym flipem. Ewentualnie przyciąć menu do viewportu dodając klasę scrollowania `overflow-y-auto` (jak np. `max-h-[58vh]` używane w innych miejscach).

---

## 2. Błędne przypisywanie projektu (Błąd logiczny)

**Opis problemu:**
Mimo iż sztuczna inteligencja z odpowiednim progiem pewności sugeruje przypisanie sesji do obiektywnie właściwego projektu ("Metro_Szafy"), system lub aplikacja ignorują to i uporczywie dodają na sztywno sesje do projektu "Jutrzenki".

Widać wyraźnie, że w tle, na interfejsie podana jest Jutrzenka, ale popup wyskakujący na danej sekcji czasu dla narzędzia `Plasticity-beta` zawiera dopisek i sugestię systemu opartą prawdopodobnie o `suggested_project_name`, która wskazuje jednoznacznie na `Metro_Szafy`.

**Sugerowane rozwiązanie:**
Zweryfikować kod przypisujący (np. autozapis przypisań albo warunki walidacyjne `onAssignSession`), by upewnić się, czy aplikacja we właściwy sposób nadpisuje projekt przypisaniem algorytmu i dlaczego to wymuszenie na błędny projekt występuje. Prawdopodobnie jakiś hook automatycznej reguły filtrującej lub cache wcześniejszego przypisania nie uwzględnia sugestii AI lub wymusza błąd mapowania ID.

CRITICAL: Należy upewnić się, że **ręczne przypisanie projektu przez użytkownika musi być ostateczne i niepodważalne**. Ręczna poprawka nie może być nadpisywana przez domyślne reguły, ale powinna stanowić twarde sprzężenie i element nauki (feedback loop) dla modelu AI, tak by po poprawieniu algorytm zapamiętywał prawidłowy wzorzec dla podobnych sesji w przyszłości.

---

## 3. Brak pełnego przewijania długiej listy projektów (Błąd UI)

**Plik:** `dashboard/src/components/dashboard/ProjectDayTimeline.tsx`

**Opis problemu:**
Menu kontekstowe u dołu listuje opcję "Assign to project", która u autentycznego użytkownika z wieloma aktywnymi projektami może stać się niezwykle długa (wiele pozycji, np. `Metro_packshots_`, ` Metro_Visuals`, `Metro_Meble` itd.). Zrzut ekranu ujawnia, że mimo wielości projektów na liście (aż do obcięcia dolnej krawędzi) menu jako całość nie skaluje się prawidłowo, a wewnętrzna lista projektów wyjeżdża poza obrys ekranu bez wyraźnego paska przewijania (scrollbara). Użytkownik nie może wtedy doscrollować na sam dół listy, by wybrać ten właściwy i zatwierdzić przypisanie.

**Sugerowane rozwiązanie:**
Sekcja z listą wyboru projektów wewnątrz wyskakującego menu ("Assign to project") bezwzględnie powinna mieć zdefiniowaną maksymalną własną wysokość i możliwość przewijania, uodparniając ją na wysokość okna (np. ograniczenie dla samej listy: `max-h-[250px] overflow-y-auto` lub relatywne liczenie do viewportu, tak by ucięcia omijano z pomocą natywnego osiowego scrollbara).
