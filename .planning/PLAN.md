# Claw-Empire Otonom Proje Analizi - Implementasyon Planı

> **Hedef:** Aperant'taki Auto Task, Roadmap ve Ideation özelliklerini Claw-Empire mimarisine entegre ederek, projelerin otomatik analiz edilip task'ların oluşturulduğu ve agent'lara atandığı otonom bir sistem kurmak.

---

## Faz Özeti

| Faz | Özellik | Açıklama | Tahmini Dosya |
|-----|---------|----------|---------------|
| 1 | AI Client | Anthropic SDK entegrasyonu (tüm fazların temeli) | 3 dosya |
| 2 | Auto Task Generation | Proje analizi → otomatik task oluşturma | 6 dosya |
| 3 | Ideation | 6 kategoride akıllı iyileştirme önerileri | 6 dosya |
| 4 | Roadmap | AI destekli proje yol haritası | 6 dosya |
| 5 | Otonom Döngü | Task oluştur → ata → çalıştır otomasyonu | 2 dosya |

---

## Faz 1: AI Client Altyapısı

### Amaç
Tüm AI özelliklerinin kullanacağı ortak Anthropic API client'ı. Claw-Empire zaten Claude Code CLI spawn ediyor ama Auto Task/Roadmap/Ideation için doğrudan API çağrısı gerekiyor.

### Yeni Dosyalar

#### `server/modules/ai/ai-client.ts`
```
- Anthropic SDK (@anthropic-ai/sdk) wrapper
- streamText() ve generateText() helper'ları
- API key yönetimi (settings tablosundan veya env'den)
- Token limitleri ve retry logic
- Abort signal desteği (uzun süren analizler için iptal)
```

#### `server/modules/ai/prompts/` (dizin)
```
- Prompt dosyaları (.md formatında, Aperant tarzı)
- Her özellik için ayrı prompt
- Dinamik context injection (proje path, dosya listesi, vb.)
```

#### `server/modules/ai/file-context.ts`
```
- Proje dosya ağacını oku (tree komutu benzeri)
- Önemli dosyaları filtrele (package.json, README, src/, vb.)
- .gitignore'a uy, node_modules/dist hariç tut
- Max token bütçesiyle dosya içeriği topla
```

### DB Değişikliği
```sql
-- settings tablosunda yeni key:
-- 'ai_api_key' → encrypted Anthropic API key
-- 'ai_model'   → default model (claude-sonnet-4-20250514)
```

### Bağımlılık
```
pnpm add @anthropic-ai/sdk
```

---

## Faz 2: Auto Task Generation (Proje Analizi → Otomatik Task)

### Amaç
Bir projeyi AI ile analiz edip eksiklikleri, hataları, TODO'ları tespit ederek otomatik task'lar oluşturmak.

### Akış
```
Kullanıcı "Projeyi Analiz Et" tıklar
  → Backend proje dosyalarını okur (file-context.ts)
  → AI'a gönderir (auto-task-discovery prompt)
  → AI JSON formatında task listesi döner
  → Her task POST /api/tasks ile oluşturulur
  → Uygun departmana ve agent'a atanır
  → WebSocket ile frontend'e broadcast
  → (Opsiyonel) Otomatik run başlatılır
```

### Yeni Dosyalar

#### `server/modules/routes/core/projects/auto-task.ts`
```typescript
// POST /api/projects/:id/auto-task
// Request: { mode: 'quick' | 'deep', auto_assign: boolean, auto_run: boolean }
// Response: SSE stream → { phase: string, progress: number, tasks: Task[] }
//
// Adımlar:
// 1. Project'i DB'den çek (path, core_goal)
// 2. file-context.ts ile proje dosyalarını topla
// 3. AI'a gönder (streaming)
// 4. JSON parse → task'ları oluştur
// 5. auto_assign=true ise uygun agent bul ve ata
// 6. auto_run=true ise POST /api/tasks/:id/run tetikle
// 7. Her adımda SSE ile progress broadcast
```

#### `server/modules/ai/prompts/auto-task-discovery.md`
```markdown
Prompt yapısı (Aperant spec-orchestrator'dan esinlenilmiş):

- Proje dosya ağacı ve önemli dosyaların içeriği verilir
- Core goal verilir
- AI şunları analiz eder:
  1. Eksik/tamamlanmamış özellikler
  2. TODO/FIXME/HACK comment'ları
  3. Test coverage eksiklikleri
  4. Hata potansiyeli olan kod
  5. Güvenlik açıkları
  6. Performance sorunları
  7. Dokümantasyon eksiklikleri

- Çıktı formatı:
  {
    "analysis_summary": "...",
    "tasks": [
      {
        "title": "...",
        "description": "...",
        "task_type": "development|design|analysis|documentation",
        "priority": 0-3,
        "department_hint": "Development|QA-QC|Design|...",
        "estimated_complexity": "low|medium|high",
        "affected_files": ["src/..."]
      }
    ]
  }
```

#### `server/modules/ai/auto-task-engine.ts`
```
- analyzeProject(projectPath, coreGoal, mode) → Task[]
- AI response'u parse et ve validate et
- Department matching: department_hint → department_id
- Agent matching: complexity + department → en uygun idle agent
- Batch task creation (POST /api/tasks'ın internal versiyonu)
```

#### `src/components/auto-task/AutoTaskModal.tsx`
```
- "Projeyi Analiz Et" butonu (ProjectManagerModal'dan veya Tasks header'dan erişilir)
- Modal: proje seçimi, mod seçimi (quick/deep), auto-assign toggle, auto-run toggle
- SSE ile progress gösterimi (faz adı, yüzde, bulunan task sayısı)
- Tamamlandığında task listesi preview
- "Onayla ve Oluştur" / "Tümünü Oluştur ve Çalıştır" butonları
```

#### `src/components/auto-task/AutoTaskProgress.tsx`
```
- Streaming progress bar
- Gerçek zamanlı bulunan task'ları listele
- Her task'ın yanında department badge ve priority göster
```

#### `src/api/organization-projects.ts` (mevcut dosyaya ekleme)
```typescript
// Yeni fonksiyon:
export async function analyzeProject(
  projectId: string,
  options: { mode: 'quick' | 'deep'; auto_assign: boolean; auto_run: boolean }
): Promise<ReadableStream> {
  // SSE endpoint'e bağlan
  // Stream olarak task'ları döndür
}
```

### Mevcut Dosya Değişiklikleri
- `server/modules/routes/core.ts` → `registerAutoTaskRoutes()` çağrısı ekle
- `src/components/ProjectManagerModal.tsx` → "Analiz Et" butonu ekle
- `src/components/TaskBoard.tsx` → Header'a "Auto Generate" butonu ekle

---

## Faz 3: Ideation (Akıllı İyileştirme Önerileri)

### Amaç
6 paralel AI analizi ile projedeki iyileştirme fırsatlarını tespit et. Her öneri tek tıkla task'a dönüştürülebilir.

### 6 Kategori (Aperant'tan)
1. **code_improvements** — Genişletilebilir kod pattern'leri
2. **ui_ux_improvements** — Kullanıcı deneyimi iyileştirmeleri
3. **security_hardening** — Güvenlik sıkılaştırma
4. **performance_optimizations** — Performans kazanımları
5. **documentation_gaps** — Eksik dokümantasyon
6. **code_quality** — Refactoring ve kod kalitesi

### Yeni DB Tablosu
```sql
CREATE TABLE IF NOT EXISTS ideation_ideas (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN (
    'code_improvements','ui_ux_improvements','security_hardening',
    'performance_optimizations','documentation_gaps','code_quality'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  rationale TEXT,
  estimated_effort TEXT CHECK(estimated_effort IN ('low','medium','high')),
  affected_files TEXT, -- JSON array
  implementation_approach TEXT,
  converted_task_id TEXT REFERENCES tasks(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','converted','dismissed')),
  created_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE INDEX IF NOT EXISTS idx_ideation_ideas_project
  ON ideation_ideas(project_id, type, status);
```

### Yeni Dosyalar

#### `server/modules/routes/core/projects/ideation.ts`
```typescript
// POST /api/projects/:id/ideation
//   → 6 paralel AI çağrısı başlat
//   → SSE stream ile her kategorinin sonuçlarını aktar
//   → DB'ye kaydet

// GET /api/projects/:id/ideation
//   → Mevcut idea'ları listele (type, status filtresi)

// POST /api/projects/:id/ideation/:ideaId/convert
//   → Idea'yı task'a dönüştür
//   → task oluştur, idea.converted_task_id güncelle, status='converted'

// PATCH /api/projects/:id/ideation/:ideaId
//   → status güncelle (dismiss, vb.)
```

#### `server/modules/ai/prompts/ideation-{type}.md` (6 dosya)
```
Her kategori için ayrı prompt:
- Proje context'i verilir
- Kategoriye özel analiz kriterleri
- JSON çıktı formatı:
  {
    "ideas": [{
      "title": "...",
      "description": "...",
      "rationale": "...",
      "estimated_effort": "low|medium|high",
      "affected_files": [...],
      "implementation_approach": "..."
    }]
  }
```

#### `server/modules/ai/ideation-engine.ts`
```
- runIdeation(projectId, types[]) → SSE stream
- Her type için paralel AI çağrısı (Promise.allSettled)
- Sonuçları DB'ye batch insert
- Duplicate detection (aynı title + project_id)
```

#### `src/components/ideation/IdeationPanel.tsx`
```
- Sol menüye veya ProjectManager'a "Ideation" sekmesi
- 6 kategori kartı (grid layout)
- Her kart: ikon, kategori adı, bulunan idea sayısı, generation status
- "Analizi Başlat" butonu
- Kategori tıklandığında idea listesi açılır
```

#### `src/components/ideation/IdeaCard.tsx`
```
- Idea kartı: title, description, effort badge, affected files
- "Task'a Dönüştür" butonu → POST /api/projects/:id/ideation/:ideaId/convert
- "Reddet" butonu → dismiss
```

#### `src/api/organization-projects.ts` (ekleme)
```typescript
export async function runIdeation(projectId: string, types?: string[]): Promise<ReadableStream>
export async function getIdeationIdeas(projectId: string, filters?): Promise<IdeationIdea[]>
export async function convertIdeaToTask(projectId: string, ideaId: string): Promise<Task>
export async function dismissIdea(projectId: string, ideaId: string): Promise<void>
```

---

## Faz 4: Roadmap (AI Destekli Yol Haritası)

### Amaç
Projenin mevcut durumunu analiz edip, hedef kitleye göre feature'lar üreterek phase'lere bölünmüş yol haritası oluşturmak.

### Çok Adımlı Süreç (Aperant'tan)
1. **Discovery** — Proje yapısını analiz et, hedef kitle ve vizyonu çıkar
2. **Feature Generation** — Discovery'ye dayanarak stratejik feature'lar üret
3. **Phase Organization** — Feature'ları phase'lere böl ve önceliklendir

### Yeni DB Tabloları
```sql
CREATE TABLE IF NOT EXISTS roadmap_discovery (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  target_audience TEXT,
  product_vision TEXT,
  current_state TEXT,     -- JSON: mevcut feature'lar, tech stack, vb.
  raw_analysis TEXT,      -- AI'ın tam discovery çıktısı
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE TABLE IF NOT EXISTS roadmap_features (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'backlog' CHECK(phase IN ('backlog','phase_1','phase_2','phase_3','phase_4')),
  status TEXT NOT NULL DEFAULT 'backlog' CHECK(status IN ('backlog','planned','in_progress','completed')),
  priority INTEGER NOT NULL DEFAULT 0,
  estimated_effort TEXT CHECK(estimated_effort IN ('low','medium','high','very_high')),
  category TEXT,          -- 'core_feature','enhancement','infrastructure','polish'
  dependencies TEXT,      -- JSON array of feature IDs
  converted_task_id TEXT REFERENCES tasks(id),
  sort_order INTEGER NOT NULL DEFAULT 99,
  created_at INTEGER DEFAULT (unixepoch()*1000),
  updated_at INTEGER DEFAULT (unixepoch()*1000)
);

CREATE INDEX IF NOT EXISTS idx_roadmap_features_project
  ON roadmap_features(project_id, phase, sort_order);
```

### Yeni Dosyalar

#### `server/modules/routes/core/projects/roadmap.ts`
```typescript
// POST /api/projects/:id/roadmap/generate
//   → Discovery + Feature Generation + Phase Organization
//   → SSE stream ile her aşamayı aktar

// GET /api/projects/:id/roadmap
//   → Discovery + features listesi

// PATCH /api/projects/:id/roadmap/features/:featureId
//   → Feature güncelle (phase, status, priority, sort_order)

// POST /api/projects/:id/roadmap/features/:featureId/convert
//   → Feature'ı task'a dönüştür

// DELETE /api/projects/:id/roadmap/features/:featureId
//   → Feature sil
```

#### `server/modules/ai/prompts/roadmap-discovery.md`
```
- Proje dosya ağacı ve önemli dosyalar verilir
- AI şunları çıkarır:
  - target_audience: Hedef kullanıcı profili
  - product_vision: Ürün vizyonu
  - current_state: Mevcut feature'lar, tech stack, olgunluk seviyesi
  - gaps: Eksik alanlar ve fırsatlar
```

#### `server/modules/ai/prompts/roadmap-features.md`
```
- Discovery sonuçları + proje context verilir
- AI stratejik feature'lar üretir:
  - Phase 1: MVP / kritik eksikler
  - Phase 2: Büyüme feature'ları
  - Phase 3: Polish ve optimizasyon
  - Phase 4: İleri düzey / ölçekleme
```

#### `server/modules/ai/roadmap-engine.ts`
```
- generateRoadmap(projectId) → SSE stream
  1. Discovery çalıştır → roadmap_discovery'ye kaydet
  2. Feature generation → roadmap_features'a batch insert
  3. Phase organization → feature'ların phase alanını güncelle
- convertFeatureToTask(featureId) → Task
```

#### `src/components/roadmap/RoadmapView.tsx`
```
- Kanban benzeri 4 kolon: Phase 1 | Phase 2 | Phase 3 | Phase 4
- Backlog alanı (üstte veya solda)
- Feature kartları drag-and-drop ile phase'ler arası taşınabilir
- Her kart: title, description, effort badge, status, category icon
- "Task'a Dönüştür" butonu
- Header'da "Roadmap Oluştur" butonu
```

#### `src/components/roadmap/RoadmapGenerateModal.tsx`
```
- Roadmap oluşturma/yeniden oluşturma dialogu
- Discovery progress gösterimi
- Feature generation progress
- Tamamlandığında roadmap preview
```

---

## Faz 5: Otonom Döngü (Otomatik Atama + Çalıştırma)

### Amaç
Auto Task / Ideation / Roadmap'ten oluşturulan task'ların otomatik olarak uygun agent'a atanıp çalıştırılması.

### Akış
```
Yeni task oluşturuldu (source: auto-task | ideation | roadmap)
  → Auto-assign engine tetiklenir
  → Department'a göre uygun idle agent bulunur
  → Agent'a atanır (POST /api/tasks/:id/assign internal)
  → Task status: inbox → planned
  → Auto-run enabled ise:
    → POST /api/tasks/:id/run tetiklenir
    → Agent CLI spawn edilir
    → Task tamamlandığında bir sonraki task alınır
```

### Değişiklikler

#### `server/modules/ai/auto-assign-engine.ts` (yeni)
```typescript
// findBestAgent(departmentId, workflowPackKey) → Agent | null
//   1. Departmandaki idle agent'ları bul
//   2. Role önceliği: senior > junior > intern (team_leader hariç)
//   3. stats_tasks_done en düşük olana ata (load balancing)
//   4. Eğer tüm agent'lar meşgulse → queue'ya ekle

// autoRunNextTask(agentId) → void
//   1. Agent'ın department'ındaki inbox task'ları bul
//   2. Priority'ye göre sırala
//   3. İlk task'ı ata ve run et
```

#### `server/modules/workflow/orchestration.ts` (mevcut dosyaya ekleme)
```
- Task completion callback'ine auto-run-next eklenmesi
- Agent idle olduğunda queue'dan sonraki task'ı çekmesi
- Configurable: settings tablosunda 'auto_run_enabled' key
```

---

## Dosya Değişiklik Özeti

### Yeni Dosyalar (toplam ~20)
```
server/modules/ai/
  ai-client.ts                              ← Faz 1
  file-context.ts                           ← Faz 1
  auto-task-engine.ts                       ← Faz 2
  ideation-engine.ts                        ← Faz 3
  roadmap-engine.ts                         ← Faz 4
  auto-assign-engine.ts                     ← Faz 5
  prompts/
    auto-task-discovery.md                  ← Faz 2
    ideation-code-improvements.md           ← Faz 3
    ideation-ui-ux-improvements.md          ← Faz 3
    ideation-security-hardening.md          ← Faz 3
    ideation-performance-optimizations.md   ← Faz 3
    ideation-documentation-gaps.md          ← Faz 3
    ideation-code-quality.md                ← Faz 3
    roadmap-discovery.md                    ← Faz 4
    roadmap-features.md                     ← Faz 4

server/modules/routes/core/projects/
  auto-task.ts                              ← Faz 2
  ideation.ts                               ← Faz 3
  roadmap.ts                                ← Faz 4

src/components/
  auto-task/
    AutoTaskModal.tsx                       ← Faz 2
    AutoTaskProgress.tsx                    ← Faz 2
  ideation/
    IdeationPanel.tsx                       ← Faz 3
    IdeaCard.tsx                            ← Faz 3
  roadmap/
    RoadmapView.tsx                         ← Faz 4
    RoadmapGenerateModal.tsx                ← Faz 4
```

### Mevcut Dosya Değişiklikleri (~8)
```
server/modules/bootstrap/schema/base-schema.ts  ← Yeni tablolar (ideation_ideas, roadmap_*)
server/modules/routes/core.ts                    ← Yeni route registrations
server/modules/workflow/orchestration.ts         ← Auto-run döngüsü
src/api/organization-projects.ts                 ← Yeni API fonksiyonları
src/components/ProjectManagerModal.tsx            ← "Analiz Et" / "Roadmap" / "Ideation" butonları
src/components/TaskBoard.tsx                     ← "Auto Generate" butonu
src/components/Sidebar.tsx                       ← Roadmap/Ideation menü item'ları
src/types/index.ts                               ← Yeni type'lar
package.json                                     ← @anthropic-ai/sdk dependency
```

---

## Uygulama Sırası ve Bağımlılıklar

```
Faz 1 (AI Client)          ← HER ŞEYİN TEMELİ, önce bu yapılır
  ↓
Faz 2 (Auto Task)          ← En yüksek değer, ilk kullanılabilir özellik
  ↓
Faz 3 (Ideation)           ← Auto Task'a benzer pattern, hızlı implement
  ↓
Faz 4 (Roadmap)            ← En karmaşık, çok adımlı AI pipeline
  ↓
Faz 5 (Otonom Döngü)       ← Tüm parçaları birleştirir
```

---

## Teknik Kararlar

1. **AI SDK seçimi:** `@anthropic-ai/sdk` direkt kullanım (Vercel AI SDK yerine, çünkü Claw-Empire Electron değil, Express backend)
2. **Streaming:** SSE (Server-Sent Events) — mevcut WebSocket hub'a ek olarak, uzun süren AI çağrıları için
3. **Prompt yönetimi:** `.md` dosyaları (Aperant pattern'i) — kolay düzenlenebilir
4. **DB migration:** `base-schema.ts`'ye ekleme (Claw-Empire'ın mevcut migration pattern'i)
5. **Frontend state:** Mevcut React pattern (hooks + API calls), Zustand eklemeye gerek yok
6. **Auto-assign:** Basit round-robin + priority — karmaşık queue sistemi gereksiz (MVP)

---

## Gereksinimler

- Anthropic API key (Claude Sonnet 4 önerilir — hız/maliyet dengesi)
- Mevcut Claw-Empire çalışır durumda
- Proje path'inin geçerli bir git repo olması
