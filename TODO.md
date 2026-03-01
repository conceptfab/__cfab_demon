# TIMEFLOW - Project Rules

- **KAŻDA NOWA FUNKCJA** musi zostać dopisana do panelu pomocy (`Help.tsx`).
- Zapis **TIMEFLOW** musi być zawsze wielkimi literami.

Aplikacja działa poprawnie, ale przeanalizuj kod projektu pod katem poprawności logiki, wydajności, możliwych optymalizacji, nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

---

Aplikacja działa poprawnie, ale przeanalizuj kod projektu pod katem poprawności logiki, wydajności, możliwych optymalizacji, nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń (cały UI ma być po angielsku (pomoc i quick start są wyjątkiem). Przeanalizuj kod i logikę odpowiedzialną za AI, bo mam wątpliwości co do jej poprawności. Wszystkie zachowania AI muszą być precyzyjnie komunikowane by zachowaniu uzytkownika było elementem treningu. Sprawdz czygoś nie warto poprawic w jej rdzeniu i założeniach. Przygotuj aplikacje do dynamicznego rozwoju - podziel ją na moduły umożliwiające łatwe aktualizacje. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

- TŁUMACZENIE
- wyszukiwanie projektów po nazwie w zakladce projekty
- mozliwosc zmiany koloru projektu w karcie projektu

TODO ??

Weź na warsztat caly system AI:

- czy zastosowana wersja AI jest odpowiednia, czy można coś poprawić, coś dodać
- wydaje mi się, że trzeba wydzieli go wyraźnie jako osobny komponent
- trening - mam wrazenie ze nie jest optymalny i "wiedza" gdzies odpływa
- chce wyraźnie widzieć jak AI ocenia daną sesje - punktacja, może warto dodać wyraźną funkcję która umożliwi nauke przez wzocnienie jeśli AI trafiła, albo karanie jeśli chybiła - przez ręczne przepisanie sesji do innego projektu lub łapkę w górę dla potwierdzenia

- AI - testy

- dodac szyforwanie danych - np tokenem

- podzial sesji na kawałki jeśli sa dowowody na realizacje kilku projektów
-

- koszty dodatkowe w ramach projektu

- menadzer projektów -> od nowa -> automatyczna lista klientow, rozpoznawanie projektów, autonumeracja, drzewa folderów

- bezpieczny generator tokenów
- splash screen/górne menu File/Exit, About
- obsłuzone pliki JSON powinny byc archiwizowane do folderu
- eksport statystyk projektu - dni/sesje/podsumowanie => czytelny PDF
- aplikacja ikona/kolor do ustawienia
