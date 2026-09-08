-- ============================================================================
-- Nationwide city coverage.
--
-- 0002 seeded 14 cities, which meant an organizer could only host a show in
-- one of those and a customer could only browse those. This migration widens
-- the catalogue to every state and union territory of India while keeping the
-- curated set of nine "popular" cities that backs the home-page rail and the
-- top of every city picker.
--
-- Slugs are derived from the name in SQL so the list below stays readable.
-- DISTINCT ON (slug) drops same-name entries (two Bilaspurs, two Aurangabads)
-- and ON CONFLICT DO NOTHING keeps the rows seeded in 0002 exactly as they
-- are, so this migration is safe to re-run and never clobbers the curated
-- images or display order.
--
-- City names follow common usage rather than the most recent official
-- renaming where the older name is what people actually search for.
-- ============================================================================

INSERT INTO cities (name, slug, state, is_popular, display_order)
SELECT DISTINCT ON (slug)
       name,
       slug,
       state,
       false,
       100
  FROM (
    SELECT v.name,
           v.state,
           trim(both '-' from regexp_replace(lower(v.name), '[^a-z0-9]+', '-', 'g')) AS slug
      FROM (VALUES
        -- ── Andhra Pradesh ──
        ('Visakhapatnam','Andhra Pradesh'), ('Vijayawada','Andhra Pradesh'), ('Guntur','Andhra Pradesh'),
        ('Nellore','Andhra Pradesh'), ('Kurnool','Andhra Pradesh'), ('Rajahmundry','Andhra Pradesh'),
        ('Kakinada','Andhra Pradesh'), ('Tirupati','Andhra Pradesh'), ('Anantapur','Andhra Pradesh'),
        ('Kadapa','Andhra Pradesh'), ('Vizianagaram','Andhra Pradesh'), ('Eluru','Andhra Pradesh'),
        ('Ongole','Andhra Pradesh'), ('Nandyal','Andhra Pradesh'), ('Machilipatnam','Andhra Pradesh'),
        ('Adoni','Andhra Pradesh'), ('Tenali','Andhra Pradesh'), ('Proddatur','Andhra Pradesh'),
        ('Chittoor','Andhra Pradesh'), ('Hindupur','Andhra Pradesh'), ('Bhimavaram','Andhra Pradesh'),
        ('Madanapalle','Andhra Pradesh'), ('Guntakal','Andhra Pradesh'), ('Dharmavaram','Andhra Pradesh'),
        ('Gudivada','Andhra Pradesh'), ('Narasaraopet','Andhra Pradesh'), ('Srikakulam','Andhra Pradesh'),
        ('Amaravati','Andhra Pradesh'), ('Puttaparthi','Andhra Pradesh'),

        -- ── Arunachal Pradesh ──
        ('Itanagar','Arunachal Pradesh'), ('Naharlagun','Arunachal Pradesh'), ('Pasighat','Arunachal Pradesh'),
        ('Tawang','Arunachal Pradesh'), ('Ziro','Arunachal Pradesh'), ('Bomdila','Arunachal Pradesh'),
        ('Tezu','Arunachal Pradesh'),

        -- ── Assam ──
        ('Guwahati','Assam'), ('Silchar','Assam'), ('Dibrugarh','Assam'), ('Jorhat','Assam'),
        ('Nagaon','Assam'), ('Tinsukia','Assam'), ('Tezpur','Assam'), ('Bongaigaon','Assam'),
        ('Dhubri','Assam'), ('Diphu','Assam'), ('Goalpara','Assam'), ('Sivasagar','Assam'),
        ('Karimganj','Assam'), ('North Lakhimpur','Assam'), ('Golaghat','Assam'), ('Barpeta','Assam'),

        -- ── Bihar ──
        ('Patna','Bihar'), ('Gaya','Bihar'), ('Bhagalpur','Bihar'), ('Muzaffarpur','Bihar'),
        ('Darbhanga','Bihar'), ('Purnia','Bihar'), ('Arrah','Bihar'), ('Begusarai','Bihar'),
        ('Katihar','Bihar'), ('Munger','Bihar'), ('Chhapra','Bihar'), ('Danapur','Bihar'),
        ('Bettiah','Bihar'), ('Saharsa','Bihar'), ('Hajipur','Bihar'), ('Sasaram','Bihar'),
        ('Dehri','Bihar'), ('Siwan','Bihar'), ('Motihari','Bihar'), ('Nawada','Bihar'),
        ('Bagaha','Bihar'), ('Buxar','Bihar'), ('Kishanganj','Bihar'), ('Jamalpur','Bihar'),
        ('Jehanabad','Bihar'), ('Bodh Gaya','Bihar'), ('Rajgir','Bihar'),

        -- ── Chhattisgarh ──
        ('Raipur','Chhattisgarh'), ('Bhilai','Chhattisgarh'), ('Bilaspur','Chhattisgarh'),
        ('Korba','Chhattisgarh'), ('Durg','Chhattisgarh'), ('Rajnandgaon','Chhattisgarh'),
        ('Raigarh','Chhattisgarh'), ('Jagdalpur','Chhattisgarh'), ('Ambikapur','Chhattisgarh'),
        ('Dhamtari','Chhattisgarh'), ('Mahasamund','Chhattisgarh'), ('Chirmiri','Chhattisgarh'),

        -- ── Goa ──
        ('Panaji','Goa'), ('Margao','Goa'), ('Vasco da Gama','Goa'), ('Mapusa','Goa'),
        ('Ponda','Goa'), ('Calangute','Goa'),

        -- ── Gujarat ──
        ('Surat','Gujarat'), ('Vadodara','Gujarat'), ('Rajkot','Gujarat'), ('Bhavnagar','Gujarat'),
        ('Jamnagar','Gujarat'), ('Gandhinagar','Gujarat'), ('Junagadh','Gujarat'), ('Anand','Gujarat'),
        ('Nadiad','Gujarat'), ('Bharuch','Gujarat'), ('Navsari','Gujarat'), ('Morbi','Gujarat'),
        ('Vapi','Gujarat'), ('Mehsana','Gujarat'), ('Surendranagar','Gujarat'), ('Gandhidham','Gujarat'),
        ('Veraval','Gujarat'), ('Porbandar','Gujarat'), ('Palanpur','Gujarat'), ('Bhuj','Gujarat'),
        ('Valsad','Gujarat'), ('Godhra','Gujarat'), ('Patan','Gujarat'), ('Amreli','Gujarat'),
        ('Dahod','Gujarat'), ('Botad','Gujarat'), ('Ankleshwar','Gujarat'), ('Deesa','Gujarat'),
        ('Jetpur','Gujarat'), ('Dwarka','Gujarat'), ('Somnath','Gujarat'),

        -- ── Haryana ──
        ('Gurugram','Haryana'), ('Faridabad','Haryana'), ('Panipat','Haryana'), ('Ambala','Haryana'),
        ('Yamunanagar','Haryana'), ('Rohtak','Haryana'), ('Hisar','Haryana'), ('Karnal','Haryana'),
        ('Sonipat','Haryana'), ('Panchkula','Haryana'), ('Bhiwani','Haryana'), ('Sirsa','Haryana'),
        ('Bahadurgarh','Haryana'), ('Jind','Haryana'), ('Kurukshetra','Haryana'), ('Kaithal','Haryana'),
        ('Rewari','Haryana'), ('Palwal','Haryana'), ('Narnaul','Haryana'), ('Fatehabad','Haryana'),
        ('Jhajjar','Haryana'), ('Manesar','Haryana'),

        -- ── Himachal Pradesh ──
        ('Shimla','Himachal Pradesh'), ('Dharamshala','Himachal Pradesh'), ('Solan','Himachal Pradesh'),
        ('Mandi','Himachal Pradesh'), ('Kullu','Himachal Pradesh'), ('Manali','Himachal Pradesh'),
        ('Palampur','Himachal Pradesh'), ('Baddi','Himachal Pradesh'), ('Nahan','Himachal Pradesh'),
        ('Una','Himachal Pradesh'), ('Hamirpur','Himachal Pradesh'), ('Chamba','Himachal Pradesh'),
        ('Dalhousie','Himachal Pradesh'), ('Kasauli','Himachal Pradesh'),

        -- ── Jharkhand ──
        ('Ranchi','Jharkhand'), ('Jamshedpur','Jharkhand'), ('Dhanbad','Jharkhand'),
        ('Bokaro Steel City','Jharkhand'), ('Deoghar','Jharkhand'), ('Hazaribagh','Jharkhand'),
        ('Giridih','Jharkhand'), ('Ramgarh','Jharkhand'), ('Medininagar','Jharkhand'),
        ('Chaibasa','Jharkhand'), ('Dumka','Jharkhand'), ('Sahibganj','Jharkhand'),

        -- ── Karnataka ──
        ('Mysuru','Karnataka'), ('Hubballi','Karnataka'), ('Dharwad','Karnataka'), ('Mangaluru','Karnataka'),
        ('Belagavi','Karnataka'), ('Kalaburagi','Karnataka'), ('Davanagere','Karnataka'), ('Ballari','Karnataka'),
        ('Vijayapura','Karnataka'), ('Shivamogga','Karnataka'), ('Tumakuru','Karnataka'), ('Raichur','Karnataka'),
        ('Bidar','Karnataka'), ('Hospet','Karnataka'), ('Hassan','Karnataka'), ('Udupi','Karnataka'),
        ('Chitradurga','Karnataka'), ('Kolar','Karnataka'), ('Mandya','Karnataka'), ('Chikkamagaluru','Karnataka'),
        ('Gadag','Karnataka'), ('Bagalkot','Karnataka'), ('Karwar','Karnataka'), ('Madikeri','Karnataka'),
        ('Hampi','Karnataka'), ('Manipal','Karnataka'), ('Yadgir','Karnataka'), ('Haveri','Karnataka'),
        ('Chikkaballapur','Karnataka'), ('Ramanagara','Karnataka'), ('Gokarna','Karnataka'),

        -- ── Kerala ──
        ('Thiruvananthapuram','Kerala'), ('Kozhikode','Kerala'), ('Thrissur','Kerala'), ('Kollam','Kerala'),
        ('Alappuzha','Kerala'), ('Kannur','Kerala'), ('Kottayam','Kerala'), ('Palakkad','Kerala'),
        ('Malappuram','Kerala'), ('Kasaragod','Kerala'), ('Pathanamthitta','Kerala'), ('Munnar','Kerala'),
        ('Kalpetta','Kerala'), ('Guruvayur','Kerala'), ('Varkala','Kerala'), ('Thalassery','Kerala'),
        ('Manjeri','Kerala'), ('Perinthalmanna','Kerala'), ('Changanassery','Kerala'), ('Kayamkulam','Kerala'),
        ('Attingal','Kerala'), ('Tirur','Kerala'), ('Aluva','Kerala'), ('Angamaly','Kerala'),
        ('Muvattupuzha','Kerala'), ('Thodupuzha','Kerala'), ('Cherthala','Kerala'), ('Kovalam','Kerala'),
        ('Kumarakom','Kerala'), ('Thekkady','Kerala'),

        -- ── Madhya Pradesh ──
        ('Bhopal','Madhya Pradesh'), ('Jabalpur','Madhya Pradesh'), ('Gwalior','Madhya Pradesh'),
        ('Ujjain','Madhya Pradesh'), ('Sagar','Madhya Pradesh'), ('Dewas','Madhya Pradesh'),
        ('Satna','Madhya Pradesh'), ('Ratlam','Madhya Pradesh'), ('Rewa','Madhya Pradesh'),
        ('Katni','Madhya Pradesh'), ('Singrauli','Madhya Pradesh'), ('Burhanpur','Madhya Pradesh'),
        ('Khandwa','Madhya Pradesh'), ('Morena','Madhya Pradesh'), ('Bhind','Madhya Pradesh'),
        ('Chhindwara','Madhya Pradesh'), ('Guna','Madhya Pradesh'), ('Shivpuri','Madhya Pradesh'),
        ('Vidisha','Madhya Pradesh'), ('Damoh','Madhya Pradesh'), ('Mandsaur','Madhya Pradesh'),
        ('Khargone','Madhya Pradesh'), ('Neemuch','Madhya Pradesh'), ('Pithampur','Madhya Pradesh'),
        ('Itarsi','Madhya Pradesh'), ('Sehore','Madhya Pradesh'), ('Betul','Madhya Pradesh'),
        ('Seoni','Madhya Pradesh'), ('Datia','Madhya Pradesh'), ('Narmadapuram','Madhya Pradesh'),
        ('Chhatarpur','Madhya Pradesh'), ('Balaghat','Madhya Pradesh'), ('Shajapur','Madhya Pradesh'),
        ('Khajuraho','Madhya Pradesh'), ('Orchha','Madhya Pradesh'), ('Pachmarhi','Madhya Pradesh'),

        -- ── Maharashtra ──
        ('Nagpur','Maharashtra'), ('Nashik','Maharashtra'), ('Thane','Maharashtra'), ('Navi Mumbai','Maharashtra'),
        ('Aurangabad','Maharashtra'), ('Solapur','Maharashtra'), ('Kolhapur','Maharashtra'),
        ('Amravati','Maharashtra'), ('Nanded','Maharashtra'), ('Sangli','Maharashtra'), ('Jalgaon','Maharashtra'),
        ('Akola','Maharashtra'), ('Latur','Maharashtra'), ('Ahmednagar','Maharashtra'), ('Dhule','Maharashtra'),
        ('Chandrapur','Maharashtra'), ('Parbhani','Maharashtra'), ('Ichalkaranji','Maharashtra'),
        ('Jalna','Maharashtra'), ('Bhusawal','Maharashtra'), ('Panvel','Maharashtra'), ('Satara','Maharashtra'),
        ('Beed','Maharashtra'), ('Yavatmal','Maharashtra'), ('Osmanabad','Maharashtra'),
        ('Nandurbar','Maharashtra'), ('Wardha','Maharashtra'), ('Ratnagiri','Maharashtra'),
        ('Alibag','Maharashtra'), ('Lonavala','Maharashtra'), ('Mahabaleshwar','Maharashtra'),
        ('Shirdi','Maharashtra'), ('Vasai-Virar','Maharashtra'), ('Kalyan','Maharashtra'),
        ('Dombivli','Maharashtra'), ('Mira Bhayandar','Maharashtra'), ('Ulhasnagar','Maharashtra'),
        ('Badlapur','Maharashtra'), ('Ambernath','Maharashtra'), ('Karad','Maharashtra'),
        ('Baramati','Maharashtra'), ('Gondia','Maharashtra'), ('Bhandara','Maharashtra'),
        ('Washim','Maharashtra'), ('Hingoli','Maharashtra'), ('Palghar','Maharashtra'),
        ('Igatpuri','Maharashtra'), ('Pandharpur','Maharashtra'),

        -- ── Manipur ──
        ('Imphal','Manipur'), ('Thoubal','Manipur'), ('Bishnupur','Manipur'), ('Churachandpur','Manipur'),
        ('Kakching','Manipur'), ('Ukhrul','Manipur'),

        -- ── Meghalaya ──
        ('Shillong','Meghalaya'), ('Tura','Meghalaya'), ('Jowai','Meghalaya'), ('Nongstoin','Meghalaya'),
        ('Cherrapunji','Meghalaya'),

        -- ── Mizoram ──
        ('Aizawl','Mizoram'), ('Lunglei','Mizoram'), ('Champhai','Mizoram'), ('Serchhip','Mizoram'),

        -- ── Nagaland ──
        ('Kohima','Nagaland'), ('Dimapur','Nagaland'), ('Mokokchung','Nagaland'), ('Tuensang','Nagaland'),
        ('Wokha','Nagaland'),

        -- ── Odisha ──
        ('Bhubaneswar','Odisha'), ('Cuttack','Odisha'), ('Rourkela','Odisha'), ('Berhampur','Odisha'),
        ('Sambalpur','Odisha'), ('Puri','Odisha'), ('Balasore','Odisha'), ('Bhadrak','Odisha'),
        ('Baripada','Odisha'), ('Jharsuguda','Odisha'), ('Jeypore','Odisha'), ('Bargarh','Odisha'),
        ('Rayagada','Odisha'), ('Angul','Odisha'), ('Dhenkanal','Odisha'), ('Paradip','Odisha'),
        ('Konark','Odisha'), ('Koraput','Odisha'), ('Kendrapara','Odisha'), ('Talcher','Odisha'),

        -- ── Punjab ──
        ('Ludhiana','Punjab'), ('Amritsar','Punjab'), ('Jalandhar','Punjab'), ('Patiala','Punjab'),
        ('Bathinda','Punjab'), ('Mohali','Punjab'), ('Hoshiarpur','Punjab'), ('Batala','Punjab'),
        ('Pathankot','Punjab'), ('Moga','Punjab'), ('Abohar','Punjab'), ('Malerkotla','Punjab'),
        ('Khanna','Punjab'), ('Phagwara','Punjab'), ('Muktsar','Punjab'), ('Barnala','Punjab'),
        ('Rajpura','Punjab'), ('Firozpur','Punjab'), ('Kapurthala','Punjab'), ('Sangrur','Punjab'),
        ('Faridkot','Punjab'), ('Gurdaspur','Punjab'), ('Zirakpur','Punjab'), ('Anandpur Sahib','Punjab'),

        -- ── Rajasthan ──
        ('Jodhpur','Rajasthan'), ('Udaipur','Rajasthan'), ('Kota','Rajasthan'), ('Bikaner','Rajasthan'),
        ('Ajmer','Rajasthan'), ('Bhilwara','Rajasthan'), ('Alwar','Rajasthan'), ('Sikar','Rajasthan'),
        ('Pali','Rajasthan'), ('Sri Ganganagar','Rajasthan'), ('Bharatpur','Rajasthan'),
        ('Hanumangarh','Rajasthan'), ('Barmer','Rajasthan'), ('Jhunjhunu','Rajasthan'), ('Churu','Rajasthan'),
        ('Tonk','Rajasthan'), ('Chittorgarh','Rajasthan'), ('Banswara','Rajasthan'), ('Nagaur','Rajasthan'),
        ('Dausa','Rajasthan'), ('Jaisalmer','Rajasthan'), ('Mount Abu','Rajasthan'), ('Pushkar','Rajasthan'),
        ('Bundi','Rajasthan'), ('Sawai Madhopur','Rajasthan'), ('Baran','Rajasthan'), ('Dungarpur','Rajasthan'),
        ('Jhalawar','Rajasthan'), ('Kishangarh','Rajasthan'), ('Beawar','Rajasthan'), ('Sirohi','Rajasthan'),
        ('Rajsamand','Rajasthan'),

        -- ── Sikkim ──
        ('Gangtok','Sikkim'), ('Namchi','Sikkim'), ('Gyalshing','Sikkim'), ('Mangan','Sikkim'),
        ('Pelling','Sikkim'), ('Ravangla','Sikkim'),

        -- ── Tamil Nadu ──
        ('Coimbatore','Tamil Nadu'), ('Madurai','Tamil Nadu'), ('Tiruchirappalli','Tamil Nadu'),
        ('Salem','Tamil Nadu'), ('Tirunelveli','Tamil Nadu'), ('Tiruppur','Tamil Nadu'), ('Erode','Tamil Nadu'),
        ('Vellore','Tamil Nadu'), ('Thoothukudi','Tamil Nadu'), ('Thanjavur','Tamil Nadu'),
        ('Dindigul','Tamil Nadu'), ('Kanchipuram','Tamil Nadu'), ('Cuddalore','Tamil Nadu'),
        ('Nagercoil','Tamil Nadu'), ('Karur','Tamil Nadu'), ('Hosur','Tamil Nadu'), ('Namakkal','Tamil Nadu'),
        ('Rajapalayam','Tamil Nadu'), ('Sivakasi','Tamil Nadu'), ('Pudukkottai','Tamil Nadu'),
        ('Udhagamandalam','Tamil Nadu'), ('Kodaikanal','Tamil Nadu'), ('Rameswaram','Tamil Nadu'),
        ('Kanyakumari','Tamil Nadu'), ('Villupuram','Tamil Nadu'), ('Tiruvannamalai','Tamil Nadu'),
        ('Krishnagiri','Tamil Nadu'), ('Dharmapuri','Tamil Nadu'), ('Ariyalur','Tamil Nadu'),
        ('Perambalur','Tamil Nadu'), ('Ramanathapuram','Tamil Nadu'), ('Virudhunagar','Tamil Nadu'),
        ('Theni','Tamil Nadu'), ('Nagapattinam','Tamil Nadu'), ('Mayiladuthurai','Tamil Nadu'),
        ('Kumbakonam','Tamil Nadu'), ('Tiruvarur','Tamil Nadu'), ('Sriperumbudur','Tamil Nadu'),
        ('Avadi','Tamil Nadu'), ('Ambattur','Tamil Nadu'), ('Tambaram','Tamil Nadu'),
        ('Mahabalipuram','Tamil Nadu'), ('Yercaud','Tamil Nadu'), ('Chidambaram','Tamil Nadu'),
        ('Tiruvallur','Tamil Nadu'), ('Chengalpattu','Tamil Nadu'), ('Sivaganga','Tamil Nadu'),
        ('Arakkonam','Tamil Nadu'),

        -- ── Telangana ──
        ('Warangal','Telangana'), ('Nizamabad','Telangana'), ('Karimnagar','Telangana'), ('Khammam','Telangana'),
        ('Ramagundam','Telangana'), ('Mahbubnagar','Telangana'), ('Nalgonda','Telangana'),
        ('Adilabad','Telangana'), ('Suryapet','Telangana'), ('Siddipet','Telangana'),
        ('Miryalaguda','Telangana'), ('Jagtial','Telangana'), ('Mancherial','Telangana'),
        ('Nirmal','Telangana'), ('Kothagudem','Telangana'), ('Sangareddy','Telangana'),
        ('Medak','Telangana'), ('Secunderabad','Telangana'),

        -- ── Tripura ──
        ('Agartala','Tripura'), ('Dharmanagar','Tripura'), ('Kailashahar','Tripura'), ('Belonia','Tripura'),
        ('Ambassa','Tripura'),

        -- ── Uttar Pradesh ──
        ('Kanpur','Uttar Pradesh'), ('Ghaziabad','Uttar Pradesh'), ('Agra','Uttar Pradesh'),
        ('Varanasi','Uttar Pradesh'), ('Meerut','Uttar Pradesh'), ('Prayagraj','Uttar Pradesh'),
        ('Noida','Uttar Pradesh'), ('Greater Noida','Uttar Pradesh'), ('Bareilly','Uttar Pradesh'),
        ('Aligarh','Uttar Pradesh'), ('Moradabad','Uttar Pradesh'), ('Saharanpur','Uttar Pradesh'),
        ('Gorakhpur','Uttar Pradesh'), ('Firozabad','Uttar Pradesh'), ('Jhansi','Uttar Pradesh'),
        ('Muzaffarnagar','Uttar Pradesh'), ('Mathura','Uttar Pradesh'), ('Vrindavan','Uttar Pradesh'),
        ('Ayodhya','Uttar Pradesh'), ('Shahjahanpur','Uttar Pradesh'), ('Rampur','Uttar Pradesh'),
        ('Farrukhabad','Uttar Pradesh'), ('Hapur','Uttar Pradesh'), ('Etawah','Uttar Pradesh'),
        ('Mirzapur','Uttar Pradesh'), ('Bulandshahr','Uttar Pradesh'), ('Sambhal','Uttar Pradesh'),
        ('Amroha','Uttar Pradesh'), ('Hardoi','Uttar Pradesh'), ('Fatehpur','Uttar Pradesh'),
        ('Raebareli','Uttar Pradesh'), ('Orai','Uttar Pradesh'), ('Sitapur','Uttar Pradesh'),
        ('Bahraich','Uttar Pradesh'), ('Modinagar','Uttar Pradesh'), ('Unnao','Uttar Pradesh'),
        ('Jaunpur','Uttar Pradesh'), ('Lakhimpur','Uttar Pradesh'), ('Banda','Uttar Pradesh'),
        ('Barabanki','Uttar Pradesh'), ('Khurja','Uttar Pradesh'), ('Gonda','Uttar Pradesh'),
        ('Mainpuri','Uttar Pradesh'), ('Lalitpur','Uttar Pradesh'), ('Etah','Uttar Pradesh'),
        ('Deoria','Uttar Pradesh'), ('Ghazipur','Uttar Pradesh'), ('Sultanpur','Uttar Pradesh'),
        ('Azamgarh','Uttar Pradesh'), ('Bijnor','Uttar Pradesh'), ('Basti','Uttar Pradesh'),
        ('Ballia','Uttar Pradesh'), ('Mau','Uttar Pradesh'), ('Pilibhit','Uttar Pradesh'),
        ('Kasganj','Uttar Pradesh'), ('Kannauj','Uttar Pradesh'), ('Chitrakoot','Uttar Pradesh'),

        -- ── Uttarakhand ──
        ('Dehradun','Uttarakhand'), ('Haridwar','Uttarakhand'), ('Roorkee','Uttarakhand'),
        ('Haldwani','Uttarakhand'), ('Rudrapur','Uttarakhand'), ('Kashipur','Uttarakhand'),
        ('Rishikesh','Uttarakhand'), ('Nainital','Uttarakhand'), ('Mussoorie','Uttarakhand'),
        ('Almora','Uttarakhand'), ('Pithoragarh','Uttarakhand'), ('Kotdwar','Uttarakhand'),
        ('Ramnagar','Uttarakhand'), ('Pauri','Uttarakhand'), ('Joshimath','Uttarakhand'),
        ('Auli','Uttarakhand'), ('Rudraprayag','Uttarakhand'), ('Bageshwar','Uttarakhand'),

        -- ── West Bengal ──
        ('Howrah','West Bengal'), ('Durgapur','West Bengal'), ('Asansol','West Bengal'),
        ('Siliguri','West Bengal'), ('Bardhaman','West Bengal'), ('Malda','West Bengal'),
        ('Kharagpur','West Bengal'), ('Haldia','West Bengal'), ('Darjeeling','West Bengal'),
        ('Kalimpong','West Bengal'), ('Jalpaiguri','West Bengal'), ('Krishnanagar','West Bengal'),
        ('Berhampore','West Bengal'), ('Bankura','West Bengal'), ('Purulia','West Bengal'),
        ('Raiganj','West Bengal'), ('Barasat','West Bengal'), ('Bidhannagar','West Bengal'),
        ('Chandannagar','West Bengal'), ('Serampore','West Bengal'), ('Shantiniketan','West Bengal'),
        ('Cooch Behar','West Bengal'), ('Balurghat','West Bengal'), ('Midnapore','West Bengal'),
        ('Habra','West Bengal'), ('Ranaghat','West Bengal'), ('Basirhat','West Bengal'),
        ('Digha','West Bengal'), ('Barrackpore','West Bengal'),

        -- ── Delhi ──
        ('New Delhi','Delhi'),

        -- ── Union territories ──
        ('Srinagar','Jammu and Kashmir'), ('Jammu','Jammu and Kashmir'), ('Anantnag','Jammu and Kashmir'),
        ('Baramulla','Jammu and Kashmir'), ('Udhampur','Jammu and Kashmir'), ('Kathua','Jammu and Kashmir'),
        ('Sopore','Jammu and Kashmir'), ('Gulmarg','Jammu and Kashmir'), ('Pahalgam','Jammu and Kashmir'),
        ('Sonamarg','Jammu and Kashmir'), ('Katra','Jammu and Kashmir'),
        ('Leh','Ladakh'), ('Kargil','Ladakh'),
        ('Puducherry','Puducherry'), ('Karaikal','Puducherry'), ('Yanam','Puducherry'), ('Mahe','Puducherry'),
        ('Port Blair','Andaman and Nicobar Islands'), ('Havelock Island','Andaman and Nicobar Islands'),
        ('Silvassa','Dadra and Nagar Haveli and Daman and Diu'),
        ('Daman','Dadra and Nagar Haveli and Daman and Diu'),
        ('Diu','Dadra and Nagar Haveli and Daman and Diu'),
        ('Kavaratti','Lakshadweep'), ('Agatti','Lakshadweep')
      ) AS v(name, state)
  ) AS derived
 ORDER BY slug, name
ON CONFLICT (slug) DO NOTHING;

-- ── Curated ordering ────────────────────────────────────────────────────────
-- Exactly nine cities stay "popular": they back the home-page rail, the footer
-- links and the shortlist at the top of every city picker. Everything else is
-- still fully selectable, it just sorts alphabetically behind them.
UPDATE cities
   SET is_popular = slug IN (
         'mumbai','delhi','bengaluru','hyderabad','pune','chennai','kolkata','ahmedabad','goa'
       );

UPDATE cities SET display_order = 100 WHERE is_popular = false;

UPDATE cities c
   SET display_order = o.ord
  FROM (VALUES
    ('mumbai', 1), ('delhi', 2), ('bengaluru', 3), ('hyderabad', 4), ('pune', 5),
    ('chennai', 6), ('kolkata', 7), ('ahmedabad', 8), ('goa', 9)
  ) AS o(slug, ord)
 WHERE c.slug = o.slug;
