#!/usr/bin/env python3
"""
upload_speaking_prompts.py
B10-PP — Upload NAR/DES/INS speaking prompts to Firestore /passages
Run from: ~/b10_corpus/b10_practice_platform/
Usage:    python3 upload_speaking_prompts.py [--dry-run] [--task NAR|DES|INS|ALL]

Final counts: NAR: 110  |  DES: 76  |  INS: 88
No audio files — speaking prompts only. Pattern mirrors ESO upload.

Filtering criteria applied:
  NAR: dropped Mistakes & Lessons Learned (sensitivity), Health illness/injury
       prompts, lending/borrowing money, budgeting/hardship, regret disclosures
  DES: dropped too-simple spaces, personal/gender-marked spaces, US-specific,
       niche/awkward, lexical ceiling risks; expanded kitchen and study room
  INS: dropped culturally variable legal processes, specialized knowledge barriers,
       US-specific admin procedures; replaced sport-specific with general sport prompt
"""

import os
import sys
import re
import argparse

# ── DESCRIPTION PROMPTS (76) ─────────────────────────────────────────────────

def build_des_prompts():
    items = [
        "Describe a car's dashboard and front interior. Include where the steering wheel, gauges, radio, and air conditioning controls are located.",
        "Describe a school cafeteria during lunch time. Include the food serving area, seating arrangement, and traffic flow.",
        "Describe the interior of a small bookstore. Explain where different book categories are located and how customers move through the space.",
        "Describe a kitchen in detail. Include where the major appliances are located, how the counter space is organized, and where cooking supplies and utensils are stored.",
        "Describe a dental office examination room. Explain where the chair, equipment, and supplies are located.",
        "Describe a smartphone's home screen layout. Include app placement, navigation features, and organization.",
        "Describe a clothing store's main floor. Explain how different clothing sections are arranged and where the fitting rooms are located.",
        "Describe a small apartment's living room. Include furniture placement and explain where each item is positioned.",
        "Describe a typical bathroom layout. Include where the sink, toilet, shower, and storage areas are positioned.",
        "Describe a gym's main workout floor. Include where different equipment zones are located and how the space is organized.",
        "Describe a pharmacy's customer area. Include where medications are stored, the consultation counter, and waiting space.",
        "Describe a refrigerator's interior organization. Include where different types of food are stored on shelves and in compartments.",
        "Describe a university lecture hall. Explain the seating arrangement, where the professor stands, and how students enter.",
        "Describe a computer desk setup. Include where the monitor, keyboard, mouse, and supplies are positioned.",
        "Describe a doctor's waiting room in detail. Explain the layout, where the reception desk is located, seating arrangement, and other features.",
        "Describe a typical office workspace for five employees. Explain desk arrangement and shared equipment placement.",
        "Describe a kitchen's main appliance area. Include where the stove, refrigerator, dishwasher, and microwave are located.",
        "Describe a car's interior seating area. Explain front and back seat arrangement, storage compartments, and safety features.",
        "Describe a public restroom in a shopping center. Include the layout, accessibility features, and fixture placement.",
        "Describe a university dormitory room. Include the furniture arrangement and explain where each item is positioned.",
        "Describe a bicycle's main parts and features. Explain where the wheels, brakes, gears, and safety equipment are located.",
        "Describe a kitchen sink area. Include where dishes are washed, dried, and stored, plus cleaning supply placement.",
        "Describe a hotel lobby. Explain the layout including reception desk, seating areas, and elevator locations.",
        "Describe a laptop computer's keyboard and screen area. Include key placement, touchpad location, and port positions.",
        "Describe a public train platform. Explain where passengers wait, information displays, and safety barriers.",
        "Describe a typical living room entertainment center. Include TV placement, remote storage, and media equipment organization.",
        "Describe a florist shop's interior. Explain where flowers are displayed, work area, and customer service space.",
        "Describe a washing machine's control panel and interior. Include button placement, settings, and loading area.",
        "Describe a small bank branch interior. Explain teller windows, customer seating, and ATM placement.",
        "Describe a study room or classroom workspace. Include where desks or tables are positioned, where books and supplies are stored, and how the space is organized for work.",
        "Describe a kitchen cabinet's interior organization. Include where dishes, glasses, and cooking supplies are stored.",
        "Describe a computer lab in a school. Explain workstation arrangement, teacher area, and equipment storage.",
        "Describe a coffee maker and surrounding counter space. Include where supplies, cups, and cleaning materials are kept.",
        "Describe a shoe store's main floor. Explain how shoes are displayed, sizing areas, and customer seating.",
        "Describe a home office setup in a bedroom corner. Include desk placement, storage solutions, and lighting arrangement.",
        "Describe an ice cream shop's serving area. Explain freezer displays, toppings station, and customer ordering space.",
        "Describe a small art studio classroom. Explain workspace setup, supply storage, and lighting arrangement.",
        "Describe a public bus interior during regular service. Explain seating arrangement, accessibility features, and safety equipment.",
        "Describe a jewelry store's display area. Include showcases, security features, and customer consultation space.",
        "Describe a kitchen pantry's organization. Include where canned goods, dry ingredients, and snacks are stored on different shelves.",
        "Describe a small hotel breakfast room. Include food display, seating arrangement, and service area.",
        "Describe a college student union building lobby. Include information desks, seating areas, and activity spaces.",
        "Describe a public library's children's section. Include book displays, reading areas, and activity spaces.",
        "Describe a small music store's instrument section. Include how instruments are displayed and demonstration areas.",
        "Describe a hospital emergency room waiting area. Include registration, seating arrangement, and information displays.",
        "Describe a kitchen spice rack organization. Include where different spices are stored and how they're arranged for easy access.",
        "Describe a public restroom at a park. Include accessibility features, maintenance areas, and layout design.",
        "Describe a bathroom mirror and sink area. Include where toiletries, towels, and personal care items are organized.",
        "Describe a public indoor market's entrance area. Include vendor stalls, customer flow, and information signs.",
        "Describe a small airport waiting gate area. Include seating, boarding area, and service counters.",
        "Describe a kitchen stove and oven area. Include where cooking utensils, pot holders, and seasonings are kept nearby.",
        "Describe a public recreation center's main lobby. Include information desk, activity room entrances, and seating.",
        "Describe a home entrance area or mudroom. Include where shoes, coats, keys, and bags are organized.",
        "Describe a small flower garden in a public space. Include plant arrangement, pathways, and seating areas.",
        "Describe a convenience store's main aisle layout. Explain product organization, refrigerated sections, and checkout placement.",
        "Describe a kitchen island or breakfast bar setup. Include seating arrangement, storage underneath, and workspace organization.",
        "Describe a small repair shop's customer waiting area. Include seating, service counter, and display of services.",
        "Describe a public pool's deck area around the water. Include safety equipment, seating, and lifeguard positions.",
        "Describe a home laundry room organization. Include where detergent, fabric softener, and cleaning supplies are stored.",
        "Describe a community health clinic's waiting room. Include registration area, seating, and privacy considerations.",
        "Describe a bicycle shop's main display area. Include bike placement, repair workspace visibility, and customer service.",
        "Describe a computer mouse and keyboard area on a desk. Include cord placement, mouse pad position, and nearby supplies.",
        "Describe a small electronics store's customer area. Explain product displays, demonstration areas, and service counter.",
        "Describe a public park's picnic area. Include table placement, trash facilities, and accessibility features.",
        "Describe a small garden center's indoor plant section. Include plant displays, watering areas, and customer paths.",
        "Describe a kitchen coffee and tea station. Include where cups, sugar, creamer, and brewing equipment are organized.",
        "Describe a corner store's refrigerated drink section. Include cooler placement, product organization, and customer access.",
        "Describe a home bookshelf organization. Include where different types of books are arranged and decorative items placed.",
        "Describe a hotel's guest services desk area. Include desk placement, waiting chairs, and brochure displays.",
        "Describe a kitchen cutting board and prep area. Include where knives, vegetables, and cooking ingredients are organized.",
        "Describe a public market's prepared food court area. Include vendor stalls, seating arrangement, and waste disposal.",
        "Describe a small town's visitor information center. Include brochure displays, seating area, and staff workspace.",
        "Describe a small hardware store's paint section. Include paint displays, color matching area, and mixing station.",
        "Describe a hotel's business center layout. Include computer stations, printing area, and seating arrangement.",
        "Describe a kitchen window area above the sink. Include where plants, cleaning supplies, and decorative items are placed.",
        "Describe a home workspace corner with a chair and small table. Include lighting, storage, and organization of supplies.",
    ]
    prompts = {}
    for i, text in enumerate(items, 1):
        pid = f'DES-{i:03d}'
        prompts[pid] = {'question': text, 'promptDescription': text, 'domain': 'DES'}
    return prompts


# ── NARRATION PROMPTS (110) ──────────────────────────────────────────────────

def build_nar_prompts():
    raw = """Problem-Solving & Challenges
1. Discuss a time you solved a problem at work or school. Narrate what happened and how you solved it.
2. Describe a time you had transportation trouble. What happened and how did the issue resolve?
3. Tell about a time when something you owned broke. How did you fix it or replace it?
4. Narrate an experience when you got lost. How did you find your way?
5. Describe a time when you missed an important appointment or event. What were the consequences?
6. Discuss a time when your plans changed unexpectedly. What did you do instead?
7. Tell about a time when you locked yourself out of your home or car. What did you do?
8. Narrate an experience when technology failed you at an important moment. How did you cope?
Travel & Transportation
9. Describe your most memorable trip. What made it special?
10. Tell about a time when your flight or train was delayed or cancelled. What happened next?
11. Narrate an experience when you visited a new city for the first time. What did you see and do?
12. Describe a time when you stayed in an unusual or interesting place. What was it like?
13. Tell about an adventure you had while traveling abroad. What happened?
14. Discuss a time when you experienced culture shock. What surprised you?
15. Describe the last time you took a road trip. Where did you go and what did you experience?
16. Tell about a time when you tried local food in another country. What was your reaction?
17. Narrate an experience at an airport or train station that you remember clearly.
18. Describe a time when you met interesting people while traveling. What did you talk about?
Learning & Education
19. Tell about a time when you learned a new skill. How did you learn it?
20. Describe your first day at a new job or school. What happened?
21. Narrate an experience when a teacher or mentor helped you significantly. What did they do?
22. Tell about a time when you studied very hard for something. What was the outcome?
23. Describe an occasion when you failed at something but learned from it. What did you learn?
24. Tell about the most difficult course or training you completed. What made it challenging?
25. Describe an experience when you taught someone something. What did you teach them?
26. Tell about a time when you didn't understand something important. How did you figure it out?
27. Discuss an educational experience outside of school that changed you. What was it?
Social Situations & Relationships
28. Describe a memorable celebration you attended. What happened at the event?
29. Tell about a time when you made a new friend. How did you meet?
30. Narrate an experience when you reconnected with someone from your past. What was it like?
31. Describe a time when you had to apologize to someone. What happened?
32. Tell about an occasion when someone did something very kind for you. What did they do?
33. Discuss a time when you helped someone in need. What was the situation?
34. Tell about a time when you attended a wedding or other important ceremony. Describe the event.
35. Narrate an experience when you had a misunderstanding with someone. How did you resolve it?
36. Describe the last time you spent quality time with family. What did you do together?
Unexpected Events & Surprises
37. Describe a time when you witnessed something unusual or unexpected. What did you see?
38. Tell about an occasion when you received a surprise. What was it and how did you react?
39. Narrate an experience when the weather caused problems for you. What happened?
40. Describe a time when you encountered an animal in an unexpected place. What occurred?
41. Tell about a moment when you realized you made a mistake. What did you do about it?
42. Discuss a time when something scary happened. How did you react?
43. Describe an occasion when you found something valuable or important. What did you do with it?
44. Tell about a time when you experienced a power outage or natural event. How did you manage?
45. Narrate an experience when you overheard something interesting or important. What was it?
46. Describe a day when everything went perfectly. What made it so good?
Health & Medical
49. Tell about an injury you experienced. How did it happen and how did you recover?
50. Describe a time when you started a new exercise or health routine. How did it go?
Food & Dining
55. Tell about a time when you tried cooking something new. How did it turn out?
56. Narrate an experience at a restaurant that you remember clearly. What happened?
57. Describe a time when you attended a dinner party or potluck. What was served?
58. Discuss a time when you had a bad experience with food. What happened?
59. Describe the last time you cooked for someone else. What did you make?
60. Tell about a time when you discovered a new favorite food. How did you find it?
61. Narrate an experience when you participated in a food-related tradition or celebration. Describe it.
62. Describe a time when you had to follow a special diet. Why and how did you manage?
Technology & Communication
63. Tell about a time when you bought a new electronic device. What was your experience?
64. Describe an occasion when you lost important data or files. What happened?
65. Narrate a time when you learned to use new software or technology. How did you learn?
66. Tell about an experience when social media played an important role in your life. What happened?
67. Describe a time when you had a video call or phone conversation you remember. What made it memorable?
68. Tell about an occasion when you sent or received an important message. What was it about?
69. Narrate a time when you fixed a technology problem yourself. How did you do it?
70. Describe an experience when you were without internet or phone service. How did it affect you?
71. Tell about a time when autocorrect or translation caused a funny situation. What happened?
72. Discuss an occasion when you used technology to solve a problem. How did it help?
Achievements & Success
73. Describe a personal goal you achieved. How did you accomplish it?
74. Tell about a time when you won something or came first. What was the competition or situation?
75. Narrate an experience when you completed something difficult. How did you feel?
76. Describe a moment when you proved someone wrong or exceeded expectations. What happened?
77. Tell about a time when you received a certificate, award, or diploma. What was it for?
78. Discuss an occasion when you accomplished something you thought was impossible. What was it?
79. Describe a time when you successfully convinced someone of your idea. How did you do it?
80. Tell about a moment when you realized you had improved significantly at something. What was it?
81. Narrate an experience when you helped someone achieve their goal. What did you do?
82. Describe a time when you made a good decision that paid off later. What was the decision?
Cultural & Artistic Experiences
89. Describe a concert or live performance you attended. What was it like?
90. Tell about a time when you visited a museum or art gallery. What did you see?
91. Narrate an experience when you participated in a cultural festival or event. Describe it.
92. Describe a movie or play that made a strong impression on you. What was it about?
93. Tell about a time when you learned about a custom or tradition different from yours. What was it?
94. Discuss an occasion when you tried a new hobby or craft. How did it go?
95. Describe a book you read that affected you. Why was it significant?
96. Tell about a time when you attended a sports event. What happened?
97. Narrate an experience when you created something artistic. What did you make?
98. Describe a time when you learned a song or dance. How did you learn it?
Decision-Making
99. Tell about an important decision you made. What factors did you consider?
100. Describe a time when you chose between two good opportunities. How did you decide?
101. Narrate an experience when you had to make a quick decision. What was the situation?
102. Tell about a time when you changed your mind about something important. Why?
104. Tell about a time when someone's advice influenced your decision. What did they say?
105. Describe a time when you made a spontaneous decision. How did it work out?
106. Tell about an occasion when you postponed making a decision. What was the result?
107. Narrate an experience when you made a difficult choice that improved your life. What was it?
Home & Living Situations
108. Describe the last time you moved to a new home or apartment. What was the experience like from the beginning to the end?
109. Tell about a time when you renovated or redecorated your living space. What did you change?
110. Narrate an experience with a neighbor that you remember. What happened?
111. Describe a time when something in your home needed urgent repair. How did you handle it?
112. Tell about an occasion when you hosted guests at your home. How did you prepare?
113. Discuss a time when you searched for a place to live. What was the process like?
114. Describe a day when you did a big cleaning or organizing project. What motivated you?
115. Tell about a time when you experienced a problem with a landlord or housing situation. What occurred?
116. Narrate an experience when you changed something about your daily routine at home. Why did you change it?
117. Describe your experience moving to a new neighborhood or city. What was different?
Money & Financial Situations
118. Tell about a time when you saved money for something important. What was it and how long did it take?
119. Describe an occasion when you found a great deal or bargain. What did you buy?
120. Narrate an experience when you had an unexpected expense. How did you manage?
122. Describe an experience when you negotiated a price. Were you successful?
123. Tell about a time when you invested time or money in yourself. What did you invest in?"""

    drop = {47,48,51,52,54,83,84,85,86,87,88,103,121,124}
    prompts = {}
    current_cat = ''
    seq = 1
    for line in raw.split('\n'):
        line = line.strip()
        if not line: continue
        m = re.match(r'^(\d+)\.\s+(.+)$', line)
        if m:
            num = int(m.group(1))
            if num not in drop:
                pid = f'NAR-{seq:03d}'
                prompts[pid] = {
                    'question': m.group(2).strip(),
                    'promptDescription': m.group(2).strip(),
                    'category': current_cat,
                    'domain': current_cat.split('&')[0].strip().upper()[:3],
                }
                seq += 1
        elif line:
            current_cat = line
    return prompts


# ── INSTRUCTIONS PROMPTS (88) ────────────────────────────────────────────────

def build_ins_prompts():
    items = [
        "Explain how to register for a university class online, from logging into the system to confirming enrollment.",
        "Explain how to prepare a simple pasta dish from start to finish, including cooking times and ingredients.",
        "Explain how to set up a new email account, including choosing a password and security settings.",
        "Explain the process of doing laundry in a shared laundromat, from sorting clothes to folding finished items.",
        "Explain how to apply for a library card, including required documents and the registration process.",
        "Explain step-by-step how to plant seeds in a small garden or flower pot.",
        "Explain how to use an ATM machine to withdraw money, including security steps and transaction completion.",
        "Explain how to prepare for a job interview, from research to the day of the interview.",
        "Explain how to send a package through the postal service, including packaging and addressing requirements.",
        "Explain the process of making a doctor's appointment by phone, from initial call to confirming the time.",
        "Explain how to change a flat tire on a car, step by step.",
        "Explain how to organize a small closet efficiently, from emptying it completely to final arrangement.",
        "Explain how to use public transportation in a new city, from planning a route to paying the fare.",
        "Explain the process of opening a bank account, including required documents and steps involved.",
        "Explain step-by-step how to renew a library book, either online or in person.",
        "Explain how to make a basic omelet, including ingredient preparation and cooking technique.",
        "Explain the process of applying for a new identification card, including required documents and steps.",
        "Explain how to backup important files on a computer, including selecting files and storage options.",
        "Explain how to plan a weekly grocery shopping trip, from making a list to storing food at home.",
        "Explain the process of setting up a small workspace at home, including furniture and equipment placement.",
        "Explain how to use a washing machine, from sorting clothes to selecting the correct cycle.",
        "Explain how to prepare a job application, from gathering documents to submitting the application.",
        "Explain the process of enrolling in a community education class, including registration and payment steps.",
        "Explain how to create a simple monthly budget, from listing income to tracking expenses.",
        "Explain how to prepare a basic first aid kit for home use, including essential supplies and organization.",
        "Explain step-by-step how to install a new app on a smartphone, including security considerations.",
        "Explain the process of returning a purchased item to a store, including receipt and timing requirements.",
        "Explain how to prepare for a long car trip, from route planning to packing essentials.",
        "Explain step-by-step how to cook rice properly, including water ratios and cooking methods.",
        "Explain the process of setting up a new internet connection at home, including equipment and activation.",
        "Explain how to prepare for a soccer match, from warm-up exercises to equipment preparation.",
        "Explain step-by-step how to clean and maintain a bicycle, including basic adjustments and safety checks.",
        "Explain how to make a basic vegetable soup, including ingredient preparation and cooking steps.",
        "Explain how to organize important personal documents, from sorting categories to secure storage.",
        "Explain step-by-step how to prepare for a swimming session, including safety checks and equipment needs.",
        "Explain the process of planning a small party or gathering, from guest list to event day preparation.",
        "Explain how to prepare a resume for job applications, including content organization and formatting.",
        "Explain step-by-step how to set up a basic exercise routine at home, including equipment and scheduling.",
        "Explain how to make scrambled eggs properly, including pan preparation and cooking technique.",
        "Explain how to prepare a weekly meal plan, including recipe selection and grocery planning.",
        "Explain step-by-step how to prepare for a basketball game, including warm-up and equipment check.",
        "Explain the process of transferring money between bank accounts, including online and phone options.",
        "Explain how to make a simple sandwich with multiple ingredients, including assembly and serving.",
        "Explain step-by-step how to set up a small indoor plant garden, including light and watering needs.",
        "Explain how to prepare for a tennis match, from equipment selection to court preparation.",
        "Explain how to organize a home filing system for bills and important papers.",
        "Explain step-by-step how to make basic fried rice using leftover rice and vegetables.",
        "Explain how to prepare for a running session, including warm-up exercises and safety considerations.",
        "Explain how to bake simple cookies, including ingredient mixing and oven temperature control.",
        "Explain step-by-step how to prepare for a volleyball game, including team coordination and equipment.",
        "Explain how to make a basic salad with dressing, including ingredient selection and preparation.",
        "Explain how to prepare for moving to a new apartment, from packing strategies to change of address.",
        "Explain step-by-step how to prepare for a cycling trip, including bike check and safety equipment.",
        "Explain how to make homemade bread, from mixing ingredients to final baking.",
        "Explain how to prepare a car for winter driving, including equipment checks and emergency supplies.",
        "Explain step-by-step how to prepare for a hiking trip, including equipment and safety preparation.",
        "Explain how to make a basic stir-fry dish, including ingredient preparation and cooking sequence.",
        "Explain how to prepare for a standardized test, including study materials and test day strategy.",
        "Explain step-by-step how to prepare for a badminton match, including equipment and warm-up routine.",
        "Explain how to make pancakes from scratch, including batter preparation and cooking technique.",
        "Explain how to prepare a basic emergency kit for home use, including supplies and storage considerations.",
        "Explain step-by-step how to prepare for a table tennis game, including paddle grip and practice routine.",
        "Explain how to cook pasta properly, including water preparation, timing, and testing for doneness.",
        "Explain how to prepare for a performance review at work, including self-evaluation and goal setting.",
        "Explain how to prepare for a practice session in a sport or physical activity you know well. Include warm-up, equipment check, and safety steps.",
        "Explain the process of planning a vacation trip, from destination research to booking confirmation.",
        "Explain how to make a basic fruit smoothie, including ingredient ratios and blending technique.",
        "Explain how to prepare for a medical procedure, including pre-appointment instructions and day-of preparation.",
        "Explain step-by-step how to make homemade pizza, from dough preparation to final baking.",
        "Explain how to cook chicken safely, including temperature checking and proper handling techniques.",
        "Explain step-by-step how to set up a voicemail greeting on a new phone system.",
        "Explain how to prepare for a dance class, including clothing selection and basic stretching.",
        "Explain how to prepare for a natural disaster emergency, including supply gathering and communication planning.",
        "Explain step-by-step how to make a basic curry dish, including spice preparation and cooking method.",
        "Explain how to prepare for a weightlifting session, including warm-up and equipment safety.",
        "Explain how to bake a simple cake, including ingredient measurement and oven management.",
        "Explain step-by-step how to set up a small home office, including equipment placement and organization.",
        "Explain how to prepare for a yoga class, including clothing and mental preparation.",
        "Explain step-by-step how to make homemade soup stock, including ingredient selection and cooking time.",
        "Explain step-by-step how to set up a basic website or blog, including platform selection and content planning.",
        "Explain how to make a basic meat dish safely, including cooking temperatures and preparation steps.",
        "Explain how to prepare for a parent-teacher conference, including question preparation and documentation review.",
        "Explain step-by-step how to prepare for a fishing trip, including equipment and location preparation.",
        "Explain how to make fresh pasta from scratch, including dough preparation and shaping techniques.",
        "Explain step-by-step how to prepare for a photography session, including equipment and lighting preparation.",
        "Explain how to make a basic dessert, including ingredient preparation and presentation.",
        "Explain step-by-step how to prepare for a camping trip, including equipment packing and safety planning.",
        "Explain how to make a traditional hot beverage properly, including ingredient ratios and serving method.",
    ]
    prompts = {}
    for i, text in enumerate(items, 1):
        pid = f'INS-{i:03d}'
        prompts[pid] = {'question': text, 'promptDescription': text, 'domain': 'INS'}
    return prompts


# ── FIREBASE UPLOAD ──────────────────────────────────────────────────────────

HOME = os.path.expanduser('~')
BASE = os.path.join(HOME, 'b10_corpus', 'b10_practice_platform')
SERVICE_ACCOUNT = os.path.join(BASE, 'service-account.json')
STORAGE_BUCKET = 'b10-practice-platform.firebasestorage.app'
FIRESTORE_COLL = 'passages'

TASK_CONFIG = {
    'NAR': {'taskType': 'NARRATION',    'corpusType': 'NAR', 'builder': build_nar_prompts},
    'DES': {'taskType': 'DESCRIPTION',  'corpusType': 'DES', 'builder': build_des_prompts},
    'INS': {'taskType': 'INSTRUCTIONS', 'corpusType': 'INS', 'builder': build_ins_prompts},
}


def main():
    parser = argparse.ArgumentParser(description='Upload NAR/DES/INS speaking prompts to Firestore.')
    parser.add_argument('--dry-run', action='store_true', help='Print without uploading.')
    parser.add_argument('--task', default='ALL', choices=['NAR', 'DES', 'INS', 'ALL'],
                        help='Which task type to upload (default: ALL).')
    args = parser.parse_args()

    tasks = ['NAR', 'DES', 'INS'] if args.task == 'ALL' else [args.task]

    if not args.dry_run:
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not firebase_admin._apps:
            cred = credentials.Certificate(SERVICE_ACCOUNT)
            firebase_admin.initialize_app(cred, {'storageBucket': STORAGE_BUCKET})
        db = firestore.client()
        print('Firebase ready.\n')
    else:
        db = None
        print('=== DRY RUN — no uploads ===\n')

    for task in tasks:
        cfg = TASK_CONFIG[task]
        prompts = cfg['builder']()
        print(f'{task}: {len(prompts)} prompts')

        success = 0
        errors = 0

        for pid, data in prompts.items():
            doc = {
                'passageId':         pid,
                'taskType':          cfg['taskType'],
                'corpusType':        cfg['corpusType'],
                'domain':            data.get('domain', task),
                'question':          data['question'],
                'promptDescription': data['promptDescription'],
                'status':            'active',
            }
            if 'category' in data:
                doc['category'] = data['category']

            if args.dry_run:
                print(f'  [DRY RUN] {pid} — {data["question"][:65]}...')
                success += 1
            else:
                try:
                    db.collection(FIRESTORE_COLL).document(pid).set(doc)
                    print(f'  ✅ {pid}')
                    success += 1
                except Exception as e:
                    print(f'  ❌ {pid}  ERROR: {e}')
                    errors += 1

        print(f'\n{"="*60}')
        print(f'{task} done.  Uploaded: {success}  |  Errors: {errors}')
        print(f'{"="*60}\n')


if __name__ == '__main__':
    main()
