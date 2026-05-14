# PM Project Numbering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nadawać nowemu projektowi PM numer = max istniejący numer dla bieżącego roku + 1 (z listy JSON ∪ skanu folderów na dysku), prezentowany w edytowalnym polu dialogu z blokadą kolizji.

**Architecture:** Logika numeracji i walidacji żyje w backendzie Rust (`pm_manager.rs`) — tam jest dostęp do dysku i `create_project`. Nowa komenda Tauri `pm_suggest_project_number` zwraca sugerowany numer; dialog pobiera go przy otwarciu i wysyła (edytowalny) numer w `PmNewProject`. `create_project` waliduje format + kolizję po obu źródłach przed utworzeniem.

**Tech Stack:** Rust (Tauri 2, chrono, serde), React + TypeScript (react-i18next), i18next JSON locales.

**Spec:** `docs/superpowers/specs/2026-05-14-pm-project-numbering-design.md`

**Konwencje projektu:**
- Komendy `cargo test` uruchamiać z katalogu `dashboard/src-tauri/` (crate binarno-bibliotekowy — NIE `--lib`).
- Testy Rust: `#[cfg(test)] mod tests` na końcu pliku, temp foldery przez `std::env::temp_dir().join(format!("..._{}", nanos))` z ręcznym sprzątaniem (wzorzec z `src-tauri/src/db.rs`).
- i18n: te same klucze muszą trafić do `pl/common.json` i `en/common.json` (lint `lint:locales` sprawdza parzystość).
- Commity: zwięzłe, prefiks `feat:` / `test:` / `chore:`, stopka `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Modyfikowane:**
- `dashboard/src-tauri/src/commands/pm_manager.rs` — logika numeracji (skan dysku, scalanie, `next_project_number`), pole `prj_number` w `PmNewProject`, walidacja w `create_project`, testy.
- `dashboard/src-tauri/src/commands/pm.rs` — nowa komenda `pm_suggest_project_number`.
- `dashboard/src-tauri/src/lib.rs` — rejestracja komendy w `invoke_handler`.
- `dashboard/src/lib/pm-types.ts` — pole `prj_number` w `PmNewProject`.
- `dashboard/src/lib/tauri/pm.ts` — binding `suggestProjectNumber` + wpis w `pmApi`.
- `dashboard/src/components/pm/PmCreateProjectDialog.tsx` — pole numeru, pobranie sugestii przy otwarciu, podgląd, walidacja, obsługa błędu kolizji.
- `dashboard/src/locales/pl/common.json` — klucze `pm.create.number*`, `pm.errors.number*`, aktualizacja `help_page.pm_feature_*`.
- `dashboard/src/locales/en/common.json` — j.w. po angielsku.

Brak nowych plików. Brak nowych zależności (`chrono`, `regex` już są — parsowanie nazw folderów robione ręcznie przez `splitn`, zgodnie ze specem).

---

## Task 1: Backend — skan dysku, scalanie numerów, nowy `next_project_number`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/pm_manager.rs` (zastąpienie `count_projects_this_year` + `next_project_number` z linii 102-115; dodanie `#[cfg(test)] mod tests` na końcu pliku)

- [ ] **Step 1: Write the failing tests**

Dopisz na końcu pliku `dashboard/src-tauri/src/commands/pm_manager.rs` (po linii 318):

```rust

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_work_folder(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tf_pm_{}_{}", tag, nanos));
        fs::create_dir_all(&dir).expect("create temp work folder");
        dir
    }

    fn mkdir(work: &Path, name: &str) {
        fs::create_dir_all(work.join(name)).expect("create project dir");
    }

    #[test]
    fn scan_disk_picks_matching_year_only() {
        let work = unique_work_folder("scan");
        let year = Local::now().format("%y").to_string();
        let other_year = if year == "00" { "99".to_string() } else { "00".to_string() };
        mkdir(&work, &format!("01_{}_ACME_Site", year));
        mkdir(&work, &format!("04_{}_ACME_Shop", year));
        mkdir(&work, &format!("07_{}_OLD_Thing", other_year)); // inny rok - pomijany
        mkdir(&work, "00_PM_NX"); // folder ustawień - pomijany
        mkdir(&work, "notes"); // bez wzorca - pomijany

        let mut nums = scan_disk_project_numbers(work.to_str().unwrap(), &year);
        nums.sort();
        assert_eq!(nums, vec![1, 4]);

        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn existing_numbers_merge_json_and_disk() {
        let work = unique_work_folder("merge");
        let year = Local::now().format("%y").to_string();
        mkdir(&work, &format!("04_{}_ACME_Shop", year)); // numer 04 tylko na dysku
        let json_project = PmProject {
            prj_folder: work.to_str().unwrap().to_string(),
            prj_number: "02".into(),
            prj_year: year.clone(),
            prj_code: format!("02{}", year),
            prj_client: "ACME".into(),
            prj_name: "Site".into(),
            prj_desc: String::new(),
            prj_full_name: format!("02_{}_ACME_Site", year),
            prj_budget: String::new(),
            prj_term: String::new(),
            prj_status: "Aktywny".into(),
        };
        write_projects(work.to_str().unwrap(), &[json_project]).expect("write json");

        let mut nums = existing_project_numbers(work.to_str().unwrap(), &year).expect("existing");
        nums.sort();
        assert_eq!(nums, vec![2, 4]);

        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn next_number_is_max_plus_one_with_gaps() {
        let work = unique_work_folder("next");
        let year = Local::now().format("%y").to_string();
        mkdir(&work, &format!("01_{}_A_X", year));
        mkdir(&work, &format!("02_{}_A_Y", year));
        mkdir(&work, &format!("04_{}_A_Z", year)); // luka przy 03 NIE jest wypełniana
        assert_eq!(next_project_number(work.to_str().unwrap()).unwrap(), "05");
        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn next_number_starts_at_01_when_empty() {
        let work = unique_work_folder("empty");
        assert_eq!(next_project_number(work.to_str().unwrap()).unwrap(), "01");
        fs::remove_dir_all(&work).ok();
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard/src-tauri && cargo test pm_manager::tests 2>&1 | tail -20`
Expected: FAIL — błąd kompilacji `cannot find function scan_disk_project_numbers` / `existing_project_numbers` oraz niezgodna sygnatura `next_project_number` (obecnie przyjmuje `&[PmProject]`).

- [ ] **Step 3: Implement the numbering functions**

W `dashboard/src-tauri/src/commands/pm_manager.rs` zastąp cały blok z linii 102-115 (funkcje `count_projects_this_year` i `next_project_number`):

```rust
fn count_projects_this_year(projects: &[PmProject]) -> usize {
    let year = Local::now().format("%y").to_string();
    projects.iter().filter(|p| p.prj_year == year).count()
}

fn next_project_number(projects: &[PmProject]) -> String {
    let count = count_projects_this_year(projects);
    let next = count + 1;
    if next < 10 {
        format!("0{}", next)
    } else {
        next.to_string()
    }
}
```

nowym kodem:

```rust
/// Skan folderu roboczego: zwraca numery `NN` projektów pasujących do wzorca
/// `NN_RR_...` dla podanego 2-cyfrowego `year`. Wpisy niepasujące, pliki
/// oraz błędy odczytu katalogu są ignorowane.
fn scan_disk_project_numbers(work_folder: &str, year: &str) -> Vec<u32> {
    let mut nums = Vec::new();
    let entries = match fs::read_dir(work_folder) {
        Ok(e) => e,
        Err(_) => return nums,
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let file_name = entry.file_name();
        let name = match file_name.to_str() {
            Some(n) => n,
            None => continue,
        };
        let mut parts = name.splitn(3, '_');
        let num_part = parts.next().unwrap_or("");
        let year_part = parts.next().unwrap_or("");
        let is_num = (2..=3).contains(&num_part.len())
            && num_part.chars().all(|c| c.is_ascii_digit());
        if is_num && year_part == year {
            if let Ok(n) = num_part.parse::<u32>() {
                nums.push(n);
            }
        }
    }
    nums
}

/// Numery zajęte w danym roku — scalone z rejestru JSON i skanu dysku.
fn existing_project_numbers(work_folder: &str, year: &str) -> Result<Vec<u32>, String> {
    let projects = read_projects(work_folder)?;
    let mut nums: Vec<u32> = projects
        .iter()
        .filter(|p| p.prj_year == year)
        .filter_map(|p| p.prj_number.trim().parse::<u32>().ok())
        .collect();
    nums.extend(scan_disk_project_numbers(work_folder, year));
    Ok(nums)
}

/// Sugerowany kolejny numer projektu dla bieżącego roku: `max(zajęte) + 1`,
/// z zerem wiodącym (`{:02}`).
pub fn next_project_number(work_folder: &str) -> Result<String, String> {
    let year = Local::now().format("%y").to_string();
    let existing = existing_project_numbers(work_folder, &year)?;
    let next = existing.into_iter().max().unwrap_or(0) + 1;
    Ok(format!("{:02}", next))
}
```

> Uwaga: stara `next_project_number(&projects)` jest jeszcze wołana w `create_project` (linia 192) — to zostanie naprawione w Task 2. Po tym kroku plik się NIE skompiluje w pełni; testy tego tasku i tak nie ruszą `create_project`, ale `cargo test` kompiluje cały crate. Dlatego Step 4 łączy się z Task 2 — patrz uwaga niżej.

> **WAŻNE:** Aby `cargo test` skompilował crate, wykonaj Task 2 Step 3 (zmiana `create_project`) PRZED uruchomieniem testów. Kolejność wykonania: Task 1 Step 1-3 → Task 2 Step 1,3 → uruchom testy obu tasków (Task 1 Step 4 i Task 2 Step 4) → commit Task 1 → commit Task 2. Jeśli realizujesz przez subagenty, połącz Task 1 i Task 2 w jedno zlecenie.

- [ ] **Step 4: Run Task 1 tests to verify they pass** (po wykonaniu Task 2 Step 3)

Run: `cd dashboard/src-tauri && cargo test pm_manager::tests::scan_disk pm_manager::tests::existing_numbers pm_manager::tests::next_number 2>&1 | tail -20`
Expected: PASS — 4 testy zielone.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/pm_manager.rs
git commit -m "$(cat <<'EOF'
feat: numbering uses max(existing)+1 from JSON and disk scan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — `prj_number` w `PmNewProject` + walidacja w `create_project`

**Files:**
- Modify: `dashboard/src-tauri/src/commands/pm_manager.rs` (struct `PmNewProject` linie 21-29; `create_project` linie 186-216; dodanie testów do `mod tests`)

- [ ] **Step 1: Write the failing tests**

Dopisz do bloku `#[cfg(test)] mod tests` w `pm_manager.rs` (przed zamykającym `}` modułu) trzy testy:

```rust

    #[test]
    fn create_project_rejects_taken_number() {
        let work = unique_work_folder("collision");
        let year = Local::now().format("%y").to_string();
        mkdir(&work, &format!("03_{}_ACME_Existing", year));

        let new = PmNewProject {
            prj_client: "ACME".into(),
            prj_name: "Dup".into(),
            prj_desc: String::new(),
            prj_budget: String::new(),
            prj_term: String::new(),
            template_id: "default".into(),
            prj_number: "3".into(),
        };
        let result = create_project(work.to_str().unwrap(), new);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("PM_NUMBER_TAKEN"));

        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn create_project_rejects_invalid_number() {
        let work = unique_work_folder("invalid");
        let new = PmNewProject {
            prj_client: "ACME".into(),
            prj_name: "Bad".into(),
            prj_desc: String::new(),
            prj_budget: String::new(),
            prj_term: String::new(),
            template_id: "default".into(),
            prj_number: "abc".into(),
        };
        assert!(create_project(work.to_str().unwrap(), new).is_err());
        fs::remove_dir_all(&work).ok();
    }

    #[test]
    fn create_project_accepts_free_number() {
        let work = unique_work_folder("ok");
        let year = Local::now().format("%y").to_string();
        let new = PmNewProject {
            prj_client: "ACME".into(),
            prj_name: "Fresh".into(),
            prj_desc: String::new(),
            prj_budget: String::new(),
            prj_term: String::new(),
            template_id: "default".into(),
            prj_number: "7".into(),
        };
        let project = create_project(work.to_str().unwrap(), new).expect("create");
        assert_eq!(project.prj_number, "07");
        assert_eq!(project.prj_year, year);
        assert_eq!(project.prj_code, format!("07{}", year));
        assert_eq!(project.prj_full_name, format!("07_{}_ACME_Fresh", year));
        assert!(work.join(format!("07_{}_ACME_Fresh", year)).is_dir());
        fs::remove_dir_all(&work).ok();
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard/src-tauri && cargo test pm_manager::tests::create_project 2>&1 | tail -20`
Expected: FAIL — błąd kompilacji: `PmNewProject` nie ma pola `prj_number`.

- [ ] **Step 3: Implement struct field + validation**

3a. W `pm_manager.rs` zastąp struct `PmNewProject` (linie 21-29):

```rust
#[derive(Debug, Deserialize)]
pub struct PmNewProject {
    pub prj_client: String,
    pub prj_name: String,
    pub prj_desc: String,
    pub prj_budget: String,
    pub prj_term: String,
    pub template_id: String,
}
```

nową wersją z polem `prj_number`:

```rust
#[derive(Debug, Deserialize)]
pub struct PmNewProject {
    pub prj_client: String,
    pub prj_name: String,
    pub prj_desc: String,
    pub prj_budget: String,
    pub prj_term: String,
    pub template_id: String,
    pub prj_number: String,
}
```

3b. W `pm_manager.rs` zastąp funkcję `create_project` (linie 186-216):

```rust
pub fn create_project(work_folder: &str, new: PmNewProject) -> Result<PmProject, String> {
    let mut projects = read_projects(work_folder)?;
    let templates = read_templates(work_folder)?;
    let template = find_template(&templates, &new.template_id);

    let year = Local::now().format("%y").to_string();
    let number = next_project_number(&projects);
    let code = format!("{}{}", number, year);
    let full_name = format!("{}_{}_{}_{}", number, year, new.prj_client, new.prj_name);

    let project = PmProject {
        prj_folder: work_folder.to_string(),
        prj_number: number,
        prj_year: year,
        prj_code: code.clone(),
        prj_client: new.prj_client,
        prj_name: new.prj_name.clone(),
        prj_desc: new.prj_desc,
        prj_full_name: full_name.clone(),
        prj_budget: new.prj_budget,
        prj_term: new.prj_term,
        prj_status: "Aktywny".to_string(),
    };

    create_dirs_tree(work_folder, &full_name, &code, &new.prj_name, &template)?;

    projects.push(project.clone());
    write_projects(work_folder, &projects)?;

    Ok(project)
}
```

nową wersją (jawny numer z wejścia + walidacja formatu i kolizji):

```rust
pub fn create_project(work_folder: &str, new: PmNewProject) -> Result<PmProject, String> {
    let mut projects = read_projects(work_folder)?;
    let templates = read_templates(work_folder)?;
    let template = find_template(&templates, &new.template_id);

    let year = Local::now().format("%y").to_string();

    let number_val: u32 = new
        .prj_number
        .trim()
        .parse()
        .map_err(|_| format!("Invalid project number: '{}'", new.prj_number.trim()))?;
    if number_val == 0 {
        return Err("Project number must be greater than 0".to_string());
    }
    let existing = existing_project_numbers(work_folder, &year)?;
    if existing.contains(&number_val) {
        return Err(format!("PM_NUMBER_TAKEN:{}", number_val));
    }
    let number = format!("{:02}", number_val);

    let code = format!("{}{}", number, year);
    let full_name = format!("{}_{}_{}_{}", number, year, new.prj_client, new.prj_name);

    let project = PmProject {
        prj_folder: work_folder.to_string(),
        prj_number: number,
        prj_year: year,
        prj_code: code.clone(),
        prj_client: new.prj_client,
        prj_name: new.prj_name.clone(),
        prj_desc: new.prj_desc,
        prj_full_name: full_name.clone(),
        prj_budget: new.prj_budget,
        prj_term: new.prj_term,
        prj_status: "Aktywny".to_string(),
    };

    create_dirs_tree(work_folder, &full_name, &code, &new.prj_name, &template)?;

    projects.push(project.clone());
    write_projects(work_folder, &projects)?;

    Ok(project)
}
```

> Po tej zmianie nie ma już wywołań starej `next_project_number(&projects)` ani `count_projects_this_year` — zostały usunięte w Task 1. Crate kompiluje się czysto.

- [ ] **Step 4: Run all `pm_manager` tests to verify they pass**

Run: `cd dashboard/src-tauri && cargo test pm_manager::tests 2>&1 | tail -20`
Expected: PASS — 7 testów zielonych (4 z Task 1 + 3 z Task 2).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src-tauri/src/commands/pm_manager.rs
git commit -m "$(cat <<'EOF'
feat: create_project takes explicit number, validates collision

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backend — komenda `pm_suggest_project_number` + rejestracja

**Files:**
- Modify: `dashboard/src-tauri/src/commands/pm.rs` (po `pm_create_project`, linia 57)
- Modify: `dashboard/src-tauri/src/lib.rs` (lista `invoke_handler`, po linii 281)

- [ ] **Step 1: Add the Tauri command**

W `dashboard/src-tauri/src/commands/pm.rs` wstaw nową komendę bezpośrednio po funkcji `pm_create_project` (po linii 57, przed `#[tauri::command]` dla `pm_update_project`):

```rust

#[tauri::command]
pub fn pm_suggest_project_number() -> Result<String, String> {
    let folder = load_work_folder()?;
    pm_manager::next_project_number(&folder)
}
```

- [ ] **Step 2: Register the command in lib.rs**

W `dashboard/src-tauri/src/lib.rs` w liście `invoke_handler` zastąp linię 281:

```rust
            commands::pm_get_projects,
```

dwiema liniami:

```rust
            commands::pm_get_projects,
            commands::pm_suggest_project_number,
```

> `commands/mod.rs` ma `pub use pm::*;` — nowa komenda jest automatycznie eksportowana, nie trzeba nic dodawać w `mod.rs`.

- [ ] **Step 3: Verify compilation**

Run: `cd dashboard/src-tauri && cargo check 2>&1 | tail -15`
Expected: `Finished` bez błędów (ostrzeżenia dopuszczalne).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src-tauri/src/commands/pm.rs dashboard/src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat: add pm_suggest_project_number Tauri command

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend — typ `PmNewProject` + binding API

**Files:**
- Modify: `dashboard/src/lib/pm-types.ts` (interface `PmNewProject`, linie 15-22)
- Modify: `dashboard/src/lib/tauri/pm.ts` (nowy binding + obiekt `pmApi`)

- [ ] **Step 1: Add `prj_number` to the TypeScript type**

W `dashboard/src/lib/pm-types.ts` zastąp interface `PmNewProject` (linie 15-22):

```ts
export interface PmNewProject {
  prj_client: string;
  prj_name: string;
  prj_desc: string;
  prj_budget: string;
  prj_term: string;
  template_id: string;
}
```

nową wersją:

```ts
export interface PmNewProject {
  prj_client: string;
  prj_name: string;
  prj_desc: string;
  prj_budget: string;
  prj_term: string;
  template_id: string;
  prj_number: string;
}
```

- [ ] **Step 2: Add the API binding**

W `dashboard/src/lib/tauri/pm.ts` dodaj binding bezpośrednio po `createPmProject` (po linii 9):

```ts

export const suggestProjectNumber = () =>
  invoke<string>('pm_suggest_project_number');
```

- [ ] **Step 3: Add the binding to the `pmApi` object**

W `dashboard/src/lib/tauri/pm.ts` w obiekcie `pmApi` zastąp linię:

```ts
  createPmProject,
```

dwiema liniami:

```ts
  createPmProject,
  suggestProjectNumber,
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -15`
Expected: brak błędów (lub tylko błędy w `PmCreateProjectDialog.tsx` o brakującym `prj_number` w payloadzie — to naprawia Task 5; jeśli wystąpią, są oczekiwane i znikną po Task 5).

> Jeśli chcesz commit czysty: wykonaj Task 4 i Task 5 razem przed `tsc`. W przeciwnym razie zacommituj Task 4 mimo oczekiwanego błędu w dialogu (kolejny task go usuwa).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/pm-types.ts dashboard/src/lib/tauri/pm.ts
git commit -m "$(cat <<'EOF'
feat: add prj_number to PmNewProject and suggestProjectNumber binding

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontend — pole numeru w dialogu tworzenia projektu

**Files:**
- Modify: `dashboard/src/components/pm/PmCreateProjectDialog.tsx`

- [ ] **Step 1: Add state for the project number**

W `PmCreateProjectDialog.tsx` zastąp linię 31:

```tsx
  const [error, setError] = useState<string | null>(null);
```

blokiem:

```tsx
  const [error, setError] = useState<string | null>(null);
  const [projectNumber, setProjectNumber] = useState('');
  const [numberLoading, setNumberLoading] = useState(false);
  const [numberError, setNumberError] = useState(false);
```

- [ ] **Step 2: Fetch the suggested number when the dialog opens**

W `PmCreateProjectDialog.tsx` po `useEffect` ładującym szablony (po linii 40, przed `const year = ...`) dodaj nowy `useEffect`:

```tsx

  useEffect(() => {
    if (!open) return;
    setNumberLoading(true);
    setNumberError(false);
    pmApi.suggestProjectNumber()
      .then((n) => setProjectNumber(n))
      .catch((e) => {
        logTauriError('pm suggest project number', e);
        setNumberError(true);
        setProjectNumber('');
      })
      .finally(() => setNumberLoading(false));
  }, [open]);
```

- [ ] **Step 3: Use the entered number in the preview**

W `PmCreateProjectDialog.tsx` zastąp linie 42-44:

```tsx
  const year = new Date().getFullYear().toString().slice(-2);
  const previewCode = `XX${year}`;
  const previewName = client && name ? `XX_${year}_${client}_${name}` : '';
```

blokiem:

```tsx
  const year = new Date().getFullYear().toString().slice(-2);
  const numberIsValid = /^\d{1,3}$/.test(projectNumber.trim()) && Number(projectNumber.trim()) > 0;
  const displayNumber = numberIsValid ? projectNumber.trim().padStart(2, '0') : 'XX';
  const previewCode = `${displayNumber}${year}`;
  const previewName = client && name ? `${displayNumber}_${year}_${client}_${name}` : '';
```

- [ ] **Step 4: Validate the number and include it in the submit payload**

W `PmCreateProjectDialog.tsx` zastąp funkcję `handleSubmit` (linie 48-69):

```tsx
  const handleSubmit = async () => {
    setError(null);
    if (!client.trim()) { setError(t('pm.errors.client_required')); return; }
    if (!name.trim()) { setError(t('pm.errors.name_required')); return; }

    setSubmitting(true);
    try {
      await pmApi.createPmProject({
        prj_client: client.trim(),
        prj_name: name.trim(),
        prj_desc: desc.trim(),
        prj_budget: budget.trim(),
        prj_term: term,
        template_id: templateId || 'default',
      });
      onCreated();
    } catch (e) {
      setError(getErrorMessage(e, t('pm.errors.create_failed')));
    } finally {
      setSubmitting(false);
    }
  };
```

nową wersją:

```tsx
  const handleSubmit = async () => {
    setError(null);
    if (!client.trim()) { setError(t('pm.errors.client_required')); return; }
    if (!name.trim()) { setError(t('pm.errors.name_required')); return; }

    const trimmedNumber = projectNumber.trim();
    if (!/^\d{1,3}$/.test(trimmedNumber) || Number(trimmedNumber) <= 0) {
      setError(t('pm.errors.number_invalid'));
      return;
    }

    setSubmitting(true);
    try {
      await pmApi.createPmProject({
        prj_client: client.trim(),
        prj_name: name.trim(),
        prj_desc: desc.trim(),
        prj_budget: budget.trim(),
        prj_term: term,
        template_id: templateId || 'default',
        prj_number: trimmedNumber,
      });
      onCreated();
    } catch (e) {
      const msg = getErrorMessage(e, t('pm.errors.create_failed'));
      if (msg.includes('PM_NUMBER_TAKEN')) {
        setError(t('pm.errors.number_taken', { number: trimmedNumber }));
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };
```

- [ ] **Step 5: Add the editable number input field**

W `PmCreateProjectDialog.tsx` wstaw nowe pole bezpośrednio po otwarciu `<div className="grid gap-3">` (po linii 81), przed komentarzem `{/* Client + Name */}`:

```tsx
          {/* Project number */}
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              {t('pm.create.number')} *
            </label>
            <input
              className="w-32 rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              value={projectNumber}
              onChange={(e) => setProjectNumber(e.target.value.replace(/\D/g, '').slice(0, 3))}
              inputMode="numeric"
              placeholder={numberLoading ? '…' : '01'}
              disabled={numberLoading}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {numberError ? t('pm.errors.number_load_failed') : t('pm.create.number_hint')}
            </p>
          </div>
```

- [ ] **Step 6: Disable submit while the number is loading or failed to load**

W `PmCreateProjectDialog.tsx` zastąp przycisk submit (linie 199-201):

```tsx
            <Button size="sm" onClick={handleSubmit} disabled={submitting}>
              {t('pm.create.submit')}
            </Button>
```

nową wersją:

```tsx
            <Button size="sm" onClick={handleSubmit} disabled={submitting || numberLoading || numberError}>
              {t('pm.create.submit')}
            </Button>
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd dashboard && npx tsc --noEmit 2>&1 | tail -15`
Expected: brak błędów.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/components/pm/PmCreateProjectDialog.tsx
git commit -m "$(cat <<'EOF'
feat: editable project number field in PM create dialog

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: i18n — klucze numeru + aktualizacja tekstów pomocy

**Files:**
- Modify: `dashboard/src/locales/pl/common.json`
- Modify: `dashboard/src/locales/en/common.json`

- [ ] **Step 1: Add `pm.create.number*` keys (PL)**

W `dashboard/src/locales/pl/common.json` zastąp fragment:

```json
      "folder_preview": "Podgląd drzewa folderów",
      "submit": "Utwórz"
```

wersją:

```json
      "folder_preview": "Podgląd drzewa folderów",
      "number": "Numer projektu",
      "number_hint": "Przydzielany automatycznie (najwyższy numer w roku + 1). Możesz go zmienić.",
      "submit": "Utwórz"
```

- [ ] **Step 2: Add `pm.errors.number*` keys (PL)**

W `dashboard/src/locales/pl/common.json` zastąp fragment:

```json
      "client_required": "Nazwa klienta jest wymagana",
      "name_required": "Nazwa projektu jest wymagana",
      "create_failed": "Nie udało się utworzyć projektu",
      "load_failed": "Nie udało się wczytać danych PM"
```

wersją:

```json
      "client_required": "Nazwa klienta jest wymagana",
      "name_required": "Nazwa projektu jest wymagana",
      "create_failed": "Nie udało się utworzyć projektu",
      "number_invalid": "Numer projektu musi być liczbą większą od zera.",
      "number_taken": "Numer {{number}} jest już zajęty w tym roku. Wybierz inny.",
      "number_load_failed": "Nie udało się ustalić numeru — sprawdź, czy folder roboczy PM jest ustawiony.",
      "load_failed": "Nie udało się wczytać danych PM"
```

- [ ] **Step 3: Update `help_page.pm_feature_*` texts (PL)**

W `dashboard/src/locales/pl/common.json` zastąp fragment:

```json
    "pm_feature_create": "Tworzenie projektu — podaj klienta, nazwę, opis, budżet i termin; numer i kod generowane automatycznie.",
    "pm_feature_numbering": "Automatyczna numeracja — numer projektu przydzielany kolejno w ramach roku (np. 01, 02, 03…).",
```

wersją:

```json
    "pm_feature_create": "Tworzenie projektu — podaj klienta, nazwę, opis, budżet i termin; numer projektu jest podpowiadany i edytowalny, kod generowany automatycznie.",
    "pm_feature_numbering": "Numeracja projektów — numer podpowiadany automatycznie jako najwyższy w danym roku + 1 (uwzględnia listę projektów i foldery na dysku); w oknie tworzenia możesz go potwierdzić lub zmienić, a numer już zajęty jest blokowany.",
```

- [ ] **Step 4: Add `pm.create.number*` keys (EN)**

W `dashboard/src/locales/en/common.json` zastąp fragment:

```json
      "folder_preview": "Folder tree preview",
      "submit": "Create"
```

wersją:

```json
      "folder_preview": "Folder tree preview",
      "number": "Project number",
      "number_hint": "Assigned automatically (highest number this year + 1). You can change it.",
      "submit": "Create"
```

- [ ] **Step 5: Add `pm.errors.number*` keys (EN)**

W `dashboard/src/locales/en/common.json` zastąp fragment:

```json
      "client_required": "Client name is required",
      "name_required": "Project name is required",
      "create_failed": "Failed to create project",
      "load_failed": "Failed to load PM data"
```

wersją:

```json
      "client_required": "Client name is required",
      "name_required": "Project name is required",
      "create_failed": "Failed to create project",
      "number_invalid": "Project number must be a number greater than zero.",
      "number_taken": "Number {{number}} is already taken this year. Pick another one.",
      "number_load_failed": "Could not determine the number — check that the PM work folder is set.",
      "load_failed": "Failed to load PM data"
```

- [ ] **Step 6: Update `help_page.pm_feature_*` texts (EN)**

W `dashboard/src/locales/en/common.json` zastąp fragment:

```json
    "pm_feature_create": "Project creation — enter client, name, description, budget and deadline; number and code are generated automatically.",
    "pm_feature_numbering": "Automatic numbering — project number assigned sequentially within the year (e.g. 01, 02, 03…).",
```

wersją:

```json
    "pm_feature_create": "Project creation — enter client, name, description, budget and deadline; the project number is suggested and editable, the code is generated automatically.",
    "pm_feature_numbering": "Project numbering — the number is suggested automatically as the highest in the given year + 1 (covering both the project list and folders on disk); in the create dialog you can confirm or change it, and a number that is already taken is blocked.",
```

- [ ] **Step 7: Verify locale JSON is valid and keys match**

Run: `cd dashboard && node -e "JSON.parse(require('fs').readFileSync('src/locales/pl/common.json','utf8')); JSON.parse(require('fs').readFileSync('src/locales/en/common.json','utf8')); console.log('JSON OK')" && npm run lint:locales 2>&1 | tail -10`
Expected: `JSON OK` oraz lint kluczy locale bez błędów.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/locales/pl/common.json dashboard/src/locales/en/common.json
git commit -m "$(cat <<'EOF'
feat: i18n keys for project number field, update PM help texts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Weryfikacja końcowa

**Files:** brak zmian — wyłącznie uruchomienie testów i weryfikacja.

- [ ] **Step 1: Run Rust tests**

Run: `cd dashboard/src-tauri && cargo test 2>&1 | tail -25`
Expected: wszystkie testy PASS, w tym 7 w `pm_manager::tests`.

- [ ] **Step 2: Run frontend typecheck + build**

Run: `cd dashboard && npx tsc --noEmit && npm run build 2>&1 | tail -15`
Expected: `tsc` bez błędów; `vite build` kończy się sukcesem (ostrzeżenia o rozmiarze bundla dopuszczalne).

- [ ] **Step 3: Run lint + frontend tests**

Run: `cd dashboard && npm run lint 2>&1 | tail -15 && npm test 2>&1 | tail -15`
Expected: lint bez błędów; `vitest run` zielony (brak nowych testów vitest — sprawdzamy brak regresji).

- [ ] **Step 4: Manual test scenario (do wykonania przez użytkownika — opisz w podsumowaniu)**

Scenariusze do sprawdzenia w aplikacji:
1. Otwórz „Nowy projekt PM" → pole „Numer projektu" pre-wypełnione sugerowanym numerem (np. `03` przy istniejących 01, 02).
2. Zmień numer → podgląd nazwy folderu (`previewName`) i kodu aktualizuje się na żywo.
3. Wpisz numer już istniejący w bieżącym roku → po „Utwórz" pojawia się komunikat „Numer N jest już zajęty…", projekt NIE powstaje.
4. Wskaż w ustawieniach PM folder z istniejącymi projektami, ale pustym/niezsynchronizowanym `projects_list.json` → sugerowany numer uwzględnia foldery na dysku.
5. Wpisz numer pusty / nieliczbowy → komunikat „Numer projektu musi być liczbą większą od zera.".
6. Utwórz projekt z poprawnym wolnym numerem → folder `NN_RR_klient_nazwa` powstaje, wpis trafia do `projects_list.json`.

- [ ] **Step 5: Final commit (jeśli pozostały niezacommitowane zmiany)**

```bash
git status --short
# jeśli czysto — nic do zrobienia; w przeciwnym razie zacommituj resztki
```

---

## Self-Review

**1. Spec coverage:**
- „max istniejący + 1" → Task 1 (`next_project_number`).
- „suma JSON ∪ skan dysku" → Task 1 (`existing_project_numbers`, `scan_disk_project_numbers`).
- „edytowalne pole pre-wypełnione" → Task 5 (Step 2 fetch, Step 5 input).
- „kolizja blokuje + komunikat" → Task 2 (`PM_NUMBER_TAKEN`), Task 5 Step 4 (obsługa błędu), Task 6 (`number_taken`).
- „komenda Tauri suggest" → Task 3.
- „pole `prj_number` w `PmNewProject`" → Task 2 (Rust), Task 4 (TS).
- „Help.tsx / dokumentacja" → Task 6 Step 3 i 6 (`help_page.pm_feature_*` zasilają `HelpPmSection`).
- „i18n `pm.create.*`" → Task 6.
- „testy Rust skan/scalanie/next/kolizja" → Task 1 + Task 2.
- Edge case „pusty folder → 01" → Task 1 test `next_number_starts_at_01_when_empty`.
- Edge case „folder roboczy nieustawiony" → komenda zwraca `Err` (`load_work_folder`), dialog: `numberError` → `number_load_failed`, submit zablokowany (Task 5 Step 2, 5, 6).
- Edge case „numer > 99" → `{:02}` i regex `\d{1,3}` to obsługują (Task 1, Task 5 Step 3-5).

**2. Placeholder scan:** Brak „TBD/TODO/handle edge cases" — każdy krok ma pełny kod lub konkretną komendę z oczekiwanym wynikiem.

**3. Type consistency:**
- `next_project_number(work_folder: &str) -> Result<String, String>` — spójne między Task 1 (definicja) a Task 3 (wywołanie w komendzie).
- `PmNewProject.prj_number: String` (Rust, Task 2) ↔ `prj_number: string` (TS, Task 4) ↔ payload `prj_number: trimmedNumber` (Task 5).
- Błąd kolizji: prefiks `PM_NUMBER_TAKEN` ustawiany w Task 2, wykrywany w Task 5 (`msg.includes('PM_NUMBER_TAKEN')`).
- Klucze i18n: `pm.create.number`, `pm.create.number_hint`, `pm.errors.number_invalid`, `pm.errors.number_taken`, `pm.errors.number_load_failed` — używane w Task 5, definiowane w Task 6 (PL+EN).
- `pmApi.suggestProjectNumber` — definiowane w Task 4, używane w Task 5.

**Uwaga wykonawcza:** Task 1 i Task 2 dotykają tego samego pliku i są współzależne kompilacyjnie (usunięcie starego `next_project_number` w Task 1 psuje `create_project` do czasu Task 2). Realizować je sekwencyjnie w tej kolejności; przy wykonaniu przez subagenty — najlepiej w jednym zleceniu.
