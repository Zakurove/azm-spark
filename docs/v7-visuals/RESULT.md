# صور عزم للإصدار السابع / Azm v7 visuals

اكتمل العمل على الصور الثابتة في الفرع المحلي `v7-visuals`، الذي أُنشئ من `azm7` عند الالتزام `cef5aca`. استُبعدت الفيديوهات بناءً على طلب المستخدم اللاحق. لم يُرفع العمل إلى أي مستودع بعيد ولم يُنشر.

The still image work is complete on the local branch `v7-visuals`, created from `azm7` at commit `cef5aca`. Videos were excluded following the user's later instruction. Nothing was pushed or deployed.

**ما أُنجز / What was made**

أُنتجت ٢٩ صورة: مرجع شخصية فهد، و١٧ صورة للحركات تشمل نسخة الكرسي المتحرك، و٥ صور لإعداد المشي، و٣ صور للصفحة الرئيسية مع ٣ نسخ طولية للهاتف. حُفظت الأصول في [masters](masters/)، مع النسخ المباشرة لتوليد الصور الطولية في [masters/raw](masters/raw/). يسجل [generation.json](generation.json) مصادر التوليد.

Created 29 images: Fahd's character reference, 17 movement images including the wheelchair variant, five walking setup images, and three landing images with three portrait versions. Masters are in [masters](masters/), with the native portrait generation outputs in [masters/raw](masters/raw/). Generation origins are recorded in [generation.json](generation.json).

أُضيفت ٥٦ نسخة WebP بعرض ١٢٠٠ و٦٠٠ بكسل. أكبر ملف حجمه ٦٤٠٩٤ بايت، وجميعها دون حد ٨٠٠٠٠ بايت. يسجل [asset-checks.json](asset-checks.json) الأبعاد والأحجام والبصمات.

Added 56 WebP files at widths of 1200 and 600 pixels. The largest file is 64094 bytes and all are below 80000 bytes. [asset-checks.json](asset-checks.json) records dimensions, sizes, and hashes.

تظهر الصور في إعداد الحركات والمشي، مع انعكاس الجهة اليسرى واختيار نسخة الكرسي المتحرك عند الحاجة. أُضيفت أقسام مدى الحركة والمشي والمدرب بالصيغتين العربية والإنجليزية بعد «كيف يعمل عزم». تستخدم الشاشات الضيقة الصور الطولية. تحميل الصور مؤجل، والأقسام الجديدة تعمل فقط عند `VITE_V7=1`.

The artwork appears in movement and walking setup, with left side mirroring and the wheelchair variant where applicable. The range, walking, and coach sections use the approved Arabic and English copy after How Azm works. Narrow screens use the portrait images. Images load lazily and the new sections are enabled only with `VITE_V7=1`.

ظل ملف التشغيل الأول للنسخة الافتراضية مطابقاً تماماً للأصل: ٢٧٧٢٨٤ بايت والبصمة نفسها. الدليل في [bundle-check.json](bundle-check.json). لم تتغير بيانات الحركات أو القياس أو قواعد السلامة أو ملفات الخادم ضمن هذا العمل.

The default build's first script remains byte for byte identical to the baseline, at 277284 bytes with the same hash. Evidence is in [bundle-check.json](bundle-check.json). This work did not change movement data, measurement logic, safety rules, or server files.

**التحقق / Verification**

1. `npm run check`: نجح / Passed.
2. `npm test`: نجح ٦٢٨٨ اختباراً، مع ٢٠ اختباراً متخطى وفق إعدادات المجموعة / 6288 passed, with 20 skipped by the suite's existing conditions.
3. `npm run format:check`: نجح / Passed.
4. `npm run build`: نجح / Passed.
5. `VITE_V7=1 npm run build`: نجح / Passed.
6. `npm run e2e`: نجح ٢٣٨ اختباراً خلال ٢٧٫١ دقيقة، مع ٨٦ اختباراً متخطى وفق إعدادات المجموعة / 238 passed in 27.1 minutes, with 86 skipped by the suite's existing conditions.

توفر [test-results.json](test-results.json) ملخص النتائج. نجحت أيضاً ٢٤ مراجعة إضافية للصور في المتصفح، مع إعداد تقليل الحركة وبدونه، ودون مخالفات وصول في المناطق المفحوصة. شملت المراجعة التحميل المؤجل، والنصوص البديلة، واحتواء الصور، وإمكانية الوصول إلى أزرار إعداد المشي. النتائج في [browser-checks.json](browser-checks.json).

[test-results.json](test-results.json) provides the result summary. An additional 24 browser checks passed with and without reduced motion, with no accessibility violations in the inspected areas. These checks covered lazy loading, alternative text, image containment, and access to walking setup buttons. Results are in [browser-checks.json](browser-checks.json).

حُفظت ١٦٨ لقطة قبل التغيير و١٦٨ بعده، إضافة إلى ١٢ لقطة تفصيلية للأقسام الجديدة و٤ لقطات للمسار الفعلي. تشمل لقطات المقارنة كل حركة بالجهتين، ونسخة الكرسي المتحرك، وإعدادات المشي، والصفحة الرئيسية، بالعربية والإنجليزية عند 390×844 و1440×900. نجحت فحوص اتجاه القراءة والانعكاس واختيار الصور وعدم تجاوز حدود العرض. أُصلح تداخل صور المشي مع النص على الكمبيوتر.

Saved 168 before screenshots and 168 after screenshots, plus 12 landing section details and four real journey screenshots. Comparisons cover every movement on both sides, the wheelchair variant, walking setup, and landing, in Arabic and English at 390×844 and 1440×900. Reading direction, mirroring, image selection, and layout boundary checks passed. A desktop overlap between walking images and text was fixed.

يمكن تصفح المقارنات من [معرض المراجعة / Review gallery](screenshots/index.html). توجد الأدلة في [before](screenshots/before/)، و[after](screenshots/after/)، و[journey](screenshots/journey/). استُخدمت مكونات التطبيق الفعلية داخل صفحة مراجعة معزولة لتغطية جميع إعدادات الحركات والمشي. التقطت الصور السابقة من نسخة البداية نفسها مع تحميل خط القاهرة.

Browse the comparisons in the [review gallery](screenshots/index.html). Evidence is in [before](screenshots/before/), [after](screenshots/after/), and [journey](screenshots/journey/). The full movement and walking matrix uses the real app components in an isolated review page. Baseline screenshots came from the original starting implementation with Cairo loaded.

شُغّل التطبيق محلياً على المنفذ 5950 مع قاعدة البيانات `/tmp/azm-visuals.sqlite`. أُنشئ حساب تجريبي، واستُكمل الاستبيان بالملف المطلوب للجهة اليمنى، وفُتح وضع الجناح بالرمز المطلوب، ثم بدأ القياس المركّز من «اليوم» ووصل إلى إعداد الحركة الأولى. جرى تحديث تاريخ الجناح إلى ٨ أكتوبر عند استئناف العمل. لم تُحفظ كلمة مرور الحساب أو رموز الجلسة في المستودع.

The app ran locally on port 5950 with `/tmp/azm-visuals.sqlite`. A test account was created, the questionnaire completed with the requested right side profile, booth access activated using the requested code, and the focused check started from Today through to its first movement setup. The booth date was updated to October 8 when work resumed. No account password or session tokens were saved in the repository.

**حدود التنفيذ / Work not performed**

لم تُنتج حلقات الحركة أو ملفات MP4 ولم يُضف تشغيل فيديو، بناءً على طلب المستخدم إلغاء الفيديوهات. بقيت الصور ثابتة في وضعي تفضيل الحركة. لم تُجرَ جلسة حركة بدنية لشخص أمام كاميرا فعلية؛ غطت المراجعة مسار الدخول وإعداد الحركات والمشي وعرض الصور.

Movement loops, MP4 files, and video playback were excluded at the user's request. The artwork remains still under both motion preferences. No physical movement session with a person in front of a real camera was performed; review covered entry, movement and walking setup, and image display.

بقي تعديل المستخدم السابق في `README.md` دون تغيير ودون إدراجه في التزامات هذا العمل. لم يُفتح ملف `.env.local` أو يُطبع أو يُعدّل، ولم تُعدّل الملفات المحظورة.

The user's preexisting `README.md` change remains untouched and outside these commits. `.env.local` was not opened, printed, or edited, and the prohibited directories were not modified.
