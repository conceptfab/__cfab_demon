# TIMEFLOW - Project Rules

- **KAŻDA NOWA FUNKCJA** musi zostać dopisana do panelu pomocy (`Help.tsx`).
- Zapis **TIMEFLOW** musi być zawsze wielkimi literami.

/requesting-code-review Aplikacja działa poprawnie, ale przeanalizuj dokładnie kod dashboard i demona pod katem:
 - poprawności i logiki,
 - UI
 - wydajności, i jej poprawy,
 - wspomagania AI,
 - synchrnozacji danych lan i online
 możliwych optymalizacji, 
 nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń oraz funkcjonalności nie opisanej w zakładkach help/pomoc. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

<!-- - smtp maila dla bug huntera -->

------------------

data.md #8 (File activity spans) — zmiana modelu danych StoredFileEntry z kaskadowym wpływem na dashboard, sync, migrację. To osobny plan. Pomijam w tym planie.

---------------------------------

ISSUE-8: podwójne parsowanie ipconfig (wymaga cache warstwy)
ISSUE-9a: peak RAM 200MB+ na merge (wymaga typowanych struktur Deserialize zamiast serde_json::Value)

Aplikacja działa poprawnie, ale przeanalizuj kod projektu pod katem poprawności logiki, wydajności, możliwych optymalizacji, nadmiarowego kodu i sugerowanych rozwiązań oraz brakujących tłumaczeń (cały UI ma być po angielsku (pomoc i quick start są wyjątkiem). Przeanalizuj kod i logikę odpowiedzialną za AI, bo mam wątpliwości co do jej poprawności. Wszystkie zachowania AI muszą być precyzyjnie komunikowane by zachowaniu uzytkownika było elementem treningu. Sprawdz czygoś nie warto poprawic w jej rdzeniu i założeniach. Przygotuj aplikacje do dynamicznego rozwoju - podziel ją na moduły umożliwiające łatwe aktualizacje. Swoje uwagi i propozycje zapisz w szczegółowym raport.md

TODO ??

<!-- - raport PDF nie drukuje 1 stronę, a dane zaiwierają więcej niż 1 strona!!! -->

<!-- - czy refresh w Dashbordzie jest potrzebny?
- podział sesji
- refactor duży plików
- znaczek na NEW -->

<!-- - czy faktycznie dziala dzielenie sesji - do sprawdzenia -->
- licznik plików edytowanych w sesji/projekcie nie działa prawidłowo - zweryfikuj czy jest szansa na wiarygodny wynik, czy warto usunąć ten licznik
<!-- - poprawa modułów sesji w raporcie z boostami, z komentarzami, z manualnymi -->
<!-- - fonty systemowe do wyboru -->
<!-- - uporządkowanie settings -> Session Split wyzej logicznie poukładane! -->
<!-- - skalowanie fontów w raporcie nie działa -->
<!-- - przycisk zapisz do pdf jest chujowym miejscu! -->
<!-- - lista fontów jest zle wyswietlana -->
- poprawic header raportu
- Activity Over Time w raporcie
