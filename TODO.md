# TIMEFLOW - Project Rules

- **KAŻDA NOWA FUNKCJA** musi zostać dopisana do panelu pomocy (`Help.tsx`).
- Zapis **TIMEFLOW** musi być zawsze wielkimi literami.

---
Aplikacja działa poprawnie, ale przeanalizuj kod projektu pod katem poprawności logiki, wydajności, możliwych optymalizacji, nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń (cały UI ma być po angielsku (pomoc i quick start są wyjątkiem). Przeanalizuj kod i logikę odpowiedzialną za AI, bo mam wątpliwości co do jej poprawności. Wszystkie zachowania AI muszą być precyzyjnie komunikowane by zachowaniu uzytkownika było elementem treningu. Sprawdz czygoś nie warto poprawic w jej rdzeniu i założeniach. Przygotuj aplikacje do dynamicznego rozwoju - podziel ją na moduły umożliwiające łatwe aktualizacje. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

TODO ??

- weryfikacja lokalizacji ustawien i parametrów UI -> czy mozna poprawic logikę ich lokalizacji i wyświetlania
- optymalizacja bazy danych - mechanizm dbający o optymalizację bazy danych
- odmrazanie projektów nie jest prawidłowo pokazywane na wszystkich widokach - na jednej zakładce jest odmrożony na innej nadal zamrożony



- AI - testy
<!-- - sprawdzić logikę systemu synchronizacji w @__client @__server- mam wątpliwość/dowody czy działa. po aktualizacji danych lokalnych powinny byc one od razu wysyłane w celu synchronizacji z innym klientem. Nie synchronizuja się dodane na innym komputerze boosty, komentarze, zapewne manualne sesje też mogą być problemem. BAzy danych maja byc aktualizowane i zmiany w sesjach. -->

- dodac szyforwanie danych - np tokenem
- 


- koszty dodatkowe w ramach projektu
<!-- - zweryfikować poprzednią metodę i rozstrzygnąć czy jest potrzebne - jeśli to usunąć stary system/kod z aplikacji. -->

<!-- - ProjectPage - musi byc możliwość edycji istniejących manualnych sesji-w tym momencie pojawia się okno do tworzenia nowej sesji -->

<!-- - co to Has manual 1s??? -->
<!-- - ProjectPage - sesje manualne muszą miec hatch jak w dashboardzie -->

<!-- - przy dodawaniu boosta konieczny jest komentarz
- po odmrożeniu projektu, przyporządkowania mu sesji - projekt zostaje zamrożony i AI nie przypisuje go do nowych sesji - projekt sie zamraza po zmianie zakladki! - musi byc mechanizm sprawdzajacy dlaczego został odmrożony - jeśli pojawił na dashboardzie jako aktualny projekt, jego licznik musi zostac zresetowany
- po kliknieciu prawym przyciskiem na projekt w dowolnym miejscu UI powinno pojawic sie menu kontekstowe z opcją: przejdz do karty projektu
 -->

- implementacja i18n

<!-- -trzeba zmienic schemat synchronizacji - dane wysłane wymagają ręcznego przyporządkowania za każdym razem. jeśli uzytkownik już przyporządkował dane, to wysłane dane powinny być automatycznie przyporządkowywane do tego samego projektu. -->

- menadzer projektów -> od nowa -> automatyczna lista klientow, rozpoznawanie projektów, autonumeracja, drzewa folderów

- bezpieczny generator tokenów
- splash screen/górne menu File/Exit, About
- obsłuzone pliki JSON powinny byc archiwizowane do folderu
- eksport statystyk projektu - dni/sesje/podsumowanie => czytelny PDF
- aplikacja ikona/kolor do ustawienia
