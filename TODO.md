# TIMEFLOW - Project Rules

- **KAŻDA NOWA FUNKCJA** musi zostać dopisana do panelu pomocy (`Help.tsx`).
- Zapis **TIMEFLOW** musi być zawsze wielkimi literami.

Aplikacja działa poprawnie, ale przeanalizuj kod projektu pod katem poprawności logiki, wydajności, możliwych optymalizacji, nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń oraz funkcjonalności nie opisanej w zakładkach help/pomoc. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

---

Aplikacja działa poprawnie, ale przeanalizuj kod projektu pod katem poprawności logiki, wydajności, możliwych optymalizacji, nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń (cały UI ma być po angielsku (pomoc i quick start są wyjątkiem). Przeanalizuj kod i logikę odpowiedzialną za AI, bo mam wątpliwości co do jej poprawności. Wszystkie zachowania AI muszą być precyzyjnie komunikowane by zachowaniu uzytkownika było elementem treningu. Sprawdz czygoś nie warto poprawic w jej rdzeniu i założeniach. Przygotuj aplikacje do dynamicznego rozwoju - podziel ją na moduły umożliwiające łatwe aktualizacje. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

TODO ??

-  licznik plików edytowanych w sesji/projekcie nie działa prawidłowo - zweryfikuj czy jest szansa na wiarygodny wynik, czy warto usunąć ten licznik
- poprawa modułów sesji w raporcie z boostami, z komentarzami, z manualnymi
- fonty systemowe do wyboru
- uporządkowanie settings -> Session Split wyzej logicznie poukładane!
- skalowanie fontów w raporcie nie działa
- przycisk zapisz do pdf jest chujowym miejscu!
- lista fontów jest zle wyswietlana
- poprawic header raportu
- Activity Over Time w raporcie

<!-- Tak, zostało jeszcze kilka rzeczy „quality”, ale bez blokera działania. -->

<!-- - szablony raportów - logo aplikacji w headerze z wersja aplikacji - podobnie jak w pomoc/help
- komentarze i boosty jako opcja w raporcie
- sesje manualne jako opcja w raporcie
- przycisk "wygeneruj raport" w lepszym miejscu
- wybór fontu i skalowanie proporcjonalne fontów
- system szablonów raportów
- możliwośc wyboru szablonu raportu  przed jego  generowaniem
- zmiana logiki podziału sesji - jeśli wg AI w sesji realizowane były 2,3 lub wiecej (max5 -opcja do ustawiena) projektów - to w sesji powinna pojawic się ikona nożyczek umożliwiająca podział sesji na mniejsze wg punktacji AI. Dopiero po podziale mozna zmienic przypisanie sesji - caly ten proces ma być kontyanuacją uczenia algorytmu AI. W ustawniach podziału sesji musi być  współczynnik tolerancji -np 1:1 - podział jest możliwy jesli w sesji projekty miały tyle samo punktów. 1:0,8 jeden z projektów lub dwa mieściły się w 80% punktacji 1 - projektu lidera sesji itp - to powinien być slider. Minimalna wartość to 0.2, maksymalna 1.0. W opcjach ma być też opcja automatycznego podzału sesji jeśli zostaną spełnione warunki podziału sesji.
- poprawinie splash screen - ma się pojawiać bezwglednie na samym poczatku aplikacji - ukrywając procesy startowe
- sprawdzenie czy wielowątkowść jest prawidłowo realizoana w aplikacji -->

<!-- 
Weź na warsztat caly system AI: -->

<!-- - czy zastosowana wersja AI jest odpowiednia, czy można coś poprawić, coś dodać
- wydaje mi się, że trzeba wydzieli go wyraźnie jako osobny komponent
- trening - mam wrazenie ze nie jest optymalny i "wiedza" gdzies odpływa
- chce wyraźnie widzieć jak AI ocenia daną sesje - punktacja, może warto dodać wyraźną funkcję która umożliwi nauke przez wzocnienie jeśli AI trafiła, albo karanie jeśli chybiła - przez ręczne przepisanie sesji do innego projektu lub łapkę w górę dla potwierdzenia -->

<!-- - AI - testy

- koszty dodatkowe w ramach projektu

- menadzer projektów -> od nowa -> automatyczna lista klientow, rozpoznawanie projektów, autonumeracja, drzewa folderów

- aplikacja ikona/kolor do ustawienia
