import {readFile,writeFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const result=await transform(await readFile('src/app/experience.ts','utf8'),{loader:'ts',format:'esm'});
const {movementSteps}=await import('data:text/javascript;base64,'+Buffer.from(result.code).toString('base64'));
const script={
 sit_tall:{ar:'ثبّت جذعك، وعدّل جلستك بهدوء.',en:'Steady your trunk. Adjust your sitting position.'},
 even_arms:{ar:'حاول تحريك ذراعيك معًا، ضمن قدرتك.',en:'Try moving your arms together, within your ability.'},
 slow_down:{ar:'تمهّل قليلًا، وتحكّم بالحركة.',en:'Slow down a little. Keep the movement controlled.'},
 fuller_range:{ar:'حاول إكمال الحركة ضمن مداك المريح.',en:'Try completing the movement within your comfortable range.'},
 relax_shoulders:{ar:'أرخِ كتفيك، وواصل بهدوء.',en:'Relax your shoulders. Move steadily.'},
 stand_fully:{ar:'عدّل استقامتك ضمن المدى المريح لك.',en:'Adjust your upright position within your comfortable range.'},
 control_descent:{ar:'عُد ببطء وتحكّم.',en:'Return slowly and with control.'},
 get_in_frame:{ar:'عدّل موضعك لتظهر المفاصل المطلوبة أمام الكاميرا.',en:'Adjust your position so the required joints are visible.'},
 move_back:{ar:'ابتعد قليلًا عن الكاميرا، إذا كانت المساحة تسمح.',en:'Move back a little, if space allows.'},
 great_rep:{ar:'أحسنت، حركة متحكَّم بها.',en:'Well done. A controlled movement.'},
 halfway:{ar:'وصلت إلى نصف المجموعة. واصل بإيقاعك.',en:'Halfway through your set. Keep your own pace.'},
 set_done:{ar:'أحسنت. انتهت المجموعة، خذ وقتك للراحة.',en:'Well done. Your set is complete. Take time to rest.'},
 stop_rest:{ar:'توقّف الآن واسترح.',en:'Stop now and rest.'},
 preview:{ar:'أهلًا بك في عزم. تحرّك على مهلك، وضمن المدى المريح لك.',en:'Welcome to Azm. Move at your own pace, within your comfortable range.'},
 calibration:{ar:'لنحدّد مداك. كرّر الحركة ببطء وبجهد مريح.',en:'Let’s find your range. Repeat the movement slowly, at a comfortable effort.'},
 training:{ar:'تم تحديد مداك. لنبدأ مجموعتك.',en:'Your range is ready. Let’s begin your set.'},
};
for(const [ex,steps] of Object.entries(movementSteps))for(let i=0;i<3;i++)script[`${ex}_${i}`]={ar:steps.ar[i],en:steps.en[i]};
const numbers=['واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة'];for(let n=1;n<=10;n++)script[`count_${n}`]={ar:numbers[n-1],en:String(n)};

// Fully vocalized (tashkeel) variants tuned for TTS pronunciation. Display text stays clean;
// the generator and the speech fallback read arTts ?? ar.
const arTts={
 sit_tall:'ثَبِّتْ جِذْعَكَ، وَعَدِّلْ جِلْسَتَكَ بِهُدُوء.',
 even_arms:'حَاوِلْ تَحْرِيكَ ذِرَاعَيْكَ مَعًا، ضِمْنَ قُدْرَتِك.',
 slow_down:'تَمَهَّلْ قَلِيلًا، وَتَحَكَّمْ بِالْحَرَكَة.',
 fuller_range:'حَاوِلْ إِكْمَالَ الْحَرَكَةِ ضِمْنَ مَدَاكَ الْمُرِيح.',
 relax_shoulders:'أَرْخِ كَتِفَيْكَ، وَوَاصِلْ بِهُدُوء.',
 stand_fully:'عَدِّلِ اسْتِقَامَتَكَ ضِمْنَ الْمَدَى الْمُرِيحِ لَك.',
 control_descent:'عُدْ بِبُطْءٍ وَتَحَكُّم.',
 get_in_frame:'عَدِّلْ مَوْضِعَكَ لِتَظْهَرَ الْمَفَاصِلُ الْمَطْلُوبَةُ أَمَامَ الْكَامِيرَا.',
 move_back:'اِبْتَعِدْ قَلِيلًا عَنِ الْكَامِيرَا، إِذَا كَانَتِ الْمَسَاحَةُ تَسْمَح.',
 great_rep:'أَحْسَنْتَ، حَرَكَةٌ مُتَحَكَّمٌ بِهَا.',
 halfway:'وَصَلْتَ إِلَى نِصْفِ الْمَجْمُوعَة. وَاصِلْ بِإِيقَاعِك.',
 set_done:'أَحْسَنْت. اِنْتَهَتِ الْمَجْمُوعَةُ، خُذْ وَقْتَكَ لِلرَّاحَة.',
 stop_rest:'تَوَقَّفِ الْآنَ وَاسْتَرِح.',
 preview:'أَهْلًا بِكَ فِي عَزْم. تَحَرَّكْ عَلَى مَهْلِكَ، وَضِمْنَ الْمَدَى الْمُرِيحِ لَك.',
 calibration:'لِنُحَدِّدْ مَدَاك. كَرِّرِ الْحَرَكَةَ بِبُطْءٍ وَبِجُهْدٍ مُرِيح.',
 training:'تَمَّ تَحْدِيدُ مَدَاك. لِنَبْدَأْ مَجْمُوعَتَك.',
 seated_shoulder_press_0:'اِبْدَأْ وَذِرَاعَاكَ عِنْدَ مُسْتَوَى الْكَتِفَيْنِ، وَاجْعَلْ جِذْعَكَ ثَابِتًا.',
 seated_shoulder_press_1:'اِرْفَعْ ذِرَاعَيْكَ فَوْقَ الرَّأْسِ ضِمْنَ الْمَدَى الْمُرِيحِ لَك.',
 seated_shoulder_press_2:'أَعِدْ ذِرَاعَيْكَ إِلَى مُسْتَوَى الْكَتِفَيْنِ بِهُدُوءٍ وَتَحَكُّم.',
 seated_biceps_curl_0:'اِبْدَأْ وَالْمِرْفَقُ بِجَانِبِ جِسْمِك. وَجِّهْ جَانِبَكَ إِلَى الْكَامِيرَا.',
 seated_biceps_curl_1:'اِثْنِ مِرْفَقَكَ وَارْفَعِ الْوَزْنَ نَحْوَ كَتِفِكَ ضِمْنَ مَدَاكَ الْمُرِيح.',
 seated_biceps_curl_2:'أَنْزِلِ الْوَزْنَ بِبُطْءٍ، مَعَ إِبْقَاءِ الْمِرْفَقِ بِجَانِبِ جِسْمِك.',
 sit_to_stand_0:'اِبْدَأْ جَالِسًا، بِحَيْثُ تُظْهِرُ الْكَامِيرَا جِسْمَكَ كَامِلًا.',
 sit_to_stand_1:'اِنْهَضْ مِنَ الْكُرْسِيِّ حَتَّى تَصِلَ إِلَى وَضْعِ الْوُقُوفِ الْمُرِيحِ لَك.',
 sit_to_stand_2:'عُدْ إِلَى الْجُلُوسِ بِبُطْءٍ وَتَحَكُّم.',
 count_1:'وَاحِد',count_2:'اِثْنَان',count_3:'ثَلَاثَة',count_4:'أَرْبَعَة',count_5:'خَمْسَة',
 count_6:'سِتَّة',count_7:'سَبْعَة',count_8:'ثَمَانِيَة',count_9:'تِسْعَة',count_10:'عَشَرَة',
};
for(const [id,t] of Object.entries(arTts))if(script[id])script[id].arTts=t;
await writeFile('src/app/voice-script.json',JSON.stringify(script,null,2)+'\n');
