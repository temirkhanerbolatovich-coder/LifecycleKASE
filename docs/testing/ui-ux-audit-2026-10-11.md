# UI/UX аудит LifecycleKASE — 2026-10-11

## Среда и метод

Проверена текущая рабочая копия на базе `eb7a602`, включая уже существовавший незакоммиченный `/qa`. Для интерактивной проверки запущен отдельный Next dev server на `127.0.0.1:3010`. Использован Codex In-app Browser на Windows; размеры viewport 1440×1000, 390×844 и 768×1024. При наличии scrollbar доступная ширина составляла соответственно 1425/375/753 px. Это контролируемая проверка интерфейса и экспертная оценка, а не исследование реальных операторов.

Все записи, выплаты, burns, роли и документы `/qa` синтетические и существуют только в памяти страницы. Финансовые UI-сценарии ниже не доказывают API authorization, Phantom signing, database persistence или Solana settlement. Защищённый публичный dashboard проверен только до входа; логин, реальные подписи и owner-среда не использовались. Browser engine/version и непосредственная Chrome/Edge приёмка не установлены.

## Проверенные сценарии

| Сценарий | Наблюдение |
| --- | --- |
| Семь разделов на desktop | Обзор, Действия, Инструменты, Инвесторы, Транзакции, Аудит, Система доступны. Document width не превышает client width. |
| Семь разделов на mobile | Все доступны через меню с текущим разделом; document width = client width 375 px, document-wide horizontal overflow не наблюдался. Это не утверждение, что широкие таблицы помещаются без локального scrolling. |
| Tablet | Система проверена при 768×1024; document/client width 753 px, overflow отсутствует. Полная матрица всех форм на tablet не выполнялась. |
| Пустой поиск действий | Несуществующая строка даёт 0 из 6 и понятное предложение изменить поиск/статус; очистка возвращает записи. |
| Купон от черновика до итога | Schedule → snapshot → calculation → submit → funding → reserve → отдельный approver → issuer → три выплаты → final receipt. Показаны 500/1000/250 = 1750 KZT-Test, 3 из 3 выплачены и резерв 0. Это QA-распределение 10/20/5; оно отличается от реального записанного coupon snapshot 9/21/5. |
| Частичное погашение | Тот же полный UI flow для существующего QA action завершён; отображён simulated final document. |
| Погашение по сроку | Выполнено после partial flow; simulated result FINALIZED, инструмент REDEEMED, в реестре 0 / 35. Условия времени здесь моделируются, а не проверяются Solana Clock. |
| Бюджет и отдельная роль | До пополнения reserve disabled с причиной; после reserve повторное действие disabled. Issuer не может approve; approver не может pay. |
| Auditor | Create action/investor controls отсутствуют; данные и результаты читаются. Это видимые ограничения QA, не серверная проверка доступа. |
| Пустая форма инвестора | Native required-validation показывает «Заполните это поле» и переводит фокус на имя. |
| Дубликат инвестора | Код QA-1 даёт «Код инвестора уже существует», введённые поля сохраняются. |
| Успешное создание инвестора | Создан page-local `UI Audit Investor / QA-AUDIT`; реестр увеличился с 3 до 4, первоначальный допуск ожидает проверки. |
| Навигация с несохранённой формой | Имя и код сохранились после Инвесторы → Транзакции → Инвесторы. Выбранная action detail сохраняется при возврате из другого раздела. |
| Ошибка следующего запроса | Явный QA failure при refresh реестра показывает ошибку; имя сохранено; следующий ручной refresh возвращает данные. Real RPC/network outage этим не воспроизводится. |
| Смена QA identity | Переход Issuer → Auditor → Issuer сохраняет simulated records, но сбрасывает unsent поля формы. См. ограничение ниже. |
| Keyboard mobile menu | Escape закрывает меню и возвращает фокус на summary текущего раздела. |
| Keyboard detail tabs | ArrowRight меняет «Работа с действием» на «Условия и источник», переводит фокус; aria-selected/aria-controls соответствуют выбранной вкладке. |
| Console | На проверенной локальной вкладке captured warn/error list пуст. Это не статический анализ всего application. |
| QA receipt download | Кнопка появилась и нажата; browser download event истёк через 10 s. Сохранение файла на диск не подтверждено; само истечение адаптера не доказывает дефект браузерного download. |
| Native 200% zoom | Пять Ctrl+Plus не изменили measured viewport/reflow; Ctrl+0 отправлен. Настоящий zoom 200% не подтверждён, CSS zoom не выдан за его замену. |

Изоляция `/qa` подтверждена чтением request adapter и соответствующими model tests в общем 330-test run. Browser Network capture не доступен через применённый read-only DOM API; запросы API/RPC не выдаются за независимо проверенные через Network. Wallet adapter в QA отсутствует, кошелёк не вызывался.

## Публичный доступ

При открытии Render web и API наблюдались отдельные страницы cold start. После старта web **публичная `/qa` показывает 404**. `/dashboard` отображает operator login и initial session check. Обнаруженный public QA gap соответствует отсутствию этих файлов в remote branch; это проблема публикации, а не отсутствующая локальная реализация.

Предварительная доступность login page не доказывает успешную authentication, текущую deployed SHA, работоспособность API/RPC или финансовый сценарий. Проверки shell попадали на Cloudflare challenge; результаты challenge нельзя считать application headers или сбоями приложения. Дополнительный browser API read-back записан в [общем аудите](../PROJECT_AUDIT_2026-10-11.md).

## Насколько легко пользоваться

| Аспект | Оценка | Основание |
| --- | --- | --- |
| Найти раздел и вернуться | Хорошо | Семь постоянных разделов, mobile menu, hash-selected card и сохранение полей при обычной навигации. |
| Понять результат и ошибку | Хорошо в проверенных сценариях | Статус, сумма, число получателей, inline error, причина disabled controls, явные simulation labels. |
| Выполнить знакомую операторскую задачу | Приемлемо после обучения | Шаги отделяют funding/reserve/approval/payment; неверный порядок блокируется. Многие действия и смены роли требуют понимания процесса. |
| Начать без финансового/блокчейн опыта | Сложно | snapshot, record time, entitlements, finalized, отдельные application/on-chain состояния и несколько документов требуют объяснения. UI не заменяет короткое обучение. |
| Мобильное чтение | Приемлемо | Нет document overflow; меню работает. QA header/settings занимают около 450 px из 844 px до session/menu, оставляя мало места задаче. |
| Международная демонстрация | Пока не готово | Видимые labels, errors, dates и инструкции преимущественно RU, выбора локали нет; публичная QA ссылка недоступна. |

Числовой usability score или процент завершения пользователями не присваивается: тестировали интерфейс, а не репрезентативную группу операторов. Проверенные positive flows не являются доказательством того, что новичок самостоятельно завершит их быстро.

## Приоритетные улучшения

1. **До сдачи:** цельный EN recording/reviewer path и опубликованная рабочая ссылка. Оставить видимую маркировку Localnet/QA/KZT-Test; английский текст не должен изменять signed/canonical evidence.
2. **Ближайшее UX улучшение:** конкретный следующий шаг вместо общего «Продолжить шаги симуляции»; один главный доступный CTA, сумма и причина блокировки рядом. Сохранить отдельное подтверждение уже подписанного действия и запрет повторной отправки.
3. **QA mobile:** свернуть расширенные reset/export/failure settings, сохранив видимые simulation banner и роль. Это рекомендация только QA; production wallet review нельзя скрывать таким образом.
4. **QA role switch:** предупредить о несохранённых полях или сохранять их отдельно по identity. Сейчас `changeActor` меняет generation, а `OperatorWorkspace` получает новый key (`apps/web/app/qa/qa-workspace.tsx`) и перемонтируется. Не переносить подписанные планы между чужими identities ради UX.
5. **Терминология:** короткие пояснения «кто получит / сколько / по какой фиксации / что подтверждено», технические UUID/PDA/formula оставить доступными в details. Planned record time и effective finalized cutoff должны различаться на каждом языке.
6. **Ошибки по контексту:** сообщение после duplicate investor дополнительно говорит об исходной подписи/повторной отправке, хотя это обычная form create. Для неподписываемых операций сделать более короткую подсказку; финансовую recovery-инструкцию сохранить там, где она применима.
7. **Следующая приёмка:** реальные Administrator/Auditor/approver Phantom flows, expiry, rejected signing и lost response в отдельной disposable среде; actual Chrome/Edge, native 200% zoom, reduced motion и screen reader. Сценарии не считать закрытыми model tests.
8. **Проверка людьми:** 3–5 релевантных операторов без подсказок проходят один купонный сценарий и объясняют cutoff/статусы. Фиксировать completion, errors, время и ошибочные ожидания; изменение интерфейса выбирать по наблюдениям.

## Снимки

- [Desktop overview](screenshots/full-audit-2026-10-11/overview-desktop.jpg)
- [QA coupon completed](screenshots/full-audit-2026-10-11/coupon-finalized-desktop.jpg)
- [Mobile system](screenshots/full-audit-2026-10-11/system-mobile.jpg)
- [Mobile actions](screenshots/full-audit-2026-10-11/actions-mobile.jpg)
- [Public QA 404](screenshots/full-audit-2026-10-11/public-qa-404.jpg)
- [Public login, initial checking state](screenshots/full-audit-2026-10-11/public-login.jpg)

Снимки локальной QA содержат только synthetic data. Public login screenshot снят до завершения initial session check и не является итоговой оценкой API availability.
