import { query, queryOne } from './pool';

/**
 * Demo menus, chosen by a restaurant's lead cuisine. Prices are in rupees and
 * scaled per restaurant so two places with the same style don't look cloned.
 */

type Diet = 'veg' | 'non_veg' | 'egg' | 'vegan';
type Badge = 'bestseller' | 'chef_special' | 'new' | 'signature';
type Dish = [name: string, description: string, price: number, diet: Diet, spice?: number, badges?: Badge[]];
type Menu = Record<string, Dish[]>;

const dish = (id: string) => `https://images.unsplash.com/${id}?w=400&q=70&auto=format&fit=crop`;

const INDIAN: Menu = {
  'Starters': [
    ['Paneer tikka', 'Charred cottage cheese, hung-curd marinade, mint chutney', 395, 'veg', 1, ['bestseller']],
    ['Murgh malai kebab', 'Cream and cheese marinated chicken off the tandoor', 465, 'non_veg', 0],
    ['Dahi ke kebab', 'Crisp hung-curd patties with a soft centre', 345, 'veg', 1],
    ['Amritsari fish', 'Gram-flour battered river sole, ajwain, lemon', 525, 'non_veg', 2],
  ],
  'Mains': [
    ['Laal maas', 'Mathania chilli mutton curry, slow cooked', 695, 'non_veg', 3, ['signature']],
    ['Dal makhani', 'Black lentils simmered overnight, white butter', 395, 'veg', 0, ['bestseller']],
    ['Butter chicken', 'Tandoori chicken in a tomato-fenugreek gravy', 545, 'non_veg', 1],
    ['Gatte ki sabzi', 'Gram-flour dumplings in spiced yoghurt curry', 375, 'veg', 2],
  ],
  'Breads & Rice': [
    ['Garlic naan', 'Tandoor bread, roasted garlic, coriander', 95, 'veg'],
    ['Missi roti', 'Gram-flour flatbread with carom', 75, 'vegan'],
    ['Dum biryani', 'Aged basmati, saffron, sealed and slow cooked', 545, 'non_veg', 2, ['chef_special']],
  ],
  'Desserts': [
    ['Ghewar with rabdi', 'Honeycomb disc, reduced milk, pistachio', 295, 'veg', 0, ['new']],
    ['Gulab jamun', 'Two warm dumplings, cardamom syrup', 195, 'veg'],
  ],
};

const ASIAN: Menu = {
  'Small plates': [
    ['Crystal vegetable dumplings', 'Water chestnut, shiitake, chilli oil', 395, 'vegan', 1, ['bestseller']],
    ['Prawn hargao', 'Translucent wrappers, sweet prawn', 545, 'non_veg', 0],
    ['Korean fried chicken', 'Gochujang glaze, sesame, pickled radish', 495, 'non_veg', 2],
  ],
  'Sushi': [
    ['Salmon nigiri (2 pc)', 'Norwegian salmon, aged soy', 595, 'non_veg', 0, ['chef_special']],
    ['Avocado uramaki', 'Cucumber, avocado, togarashi mayo', 445, 'vegan', 1],
  ],
  'Bowls & noodles': [
    ['Pad thai', 'Rice noodles, tamarind, peanuts, egg', 475, 'egg', 1],
    ['Thai green curry', 'Coconut, Thai basil, jasmine rice', 525, 'veg', 2, ['signature']],
    ['Wok-tossed hakka noodles', 'Vegetables, soy, spring onion', 395, 'vegan', 1],
  ],
  'Desserts': [['Matcha tres leches', 'Green tea sponge, milk soak', 345, 'veg', 0, ['new']]],
};

const CONTINENTAL: Menu = {
  'To share': [
    ['Truffle fries', 'Parmesan, truffle oil, aioli', 345, 'veg', 0, ['bestseller']],
    ['Mezze platter', 'Hummus, baba ganoush, muhammara, pita', 495, 'vegan', 1],
    ['Chicken wings', 'Buffalo or honey-chilli, blue cheese dip', 445, 'non_veg', 2],
  ],
  'Mains': [
    ['Wood-fired margherita', 'San Marzano, fior di latte, basil', 545, 'veg', 0, ['signature']],
    ['Grilled chicken steak', 'Mash, sautéed greens, pepper jus', 645, 'non_veg', 1],
    ['Aglio olio', 'Spaghetti, garlic, chilli, parsley', 445, 'vegan', 1],
    ['Smoked brisket', '12-hour hickory smoked, slaw, pickles', 845, 'non_veg', 1, ['chef_special']],
  ],
  'Cafe & bakes': [
    ['Avocado toast', 'Sourdough, chilli flakes, poached egg', 395, 'egg', 1],
    ['Cold brew', 'Single-origin Chikmagalur, 18-hour steep', 225, 'vegan'],
  ],
  'Desserts': [['Basque cheesecake', 'Burnt top, berry compote', 345, 'veg', 0, ['new']]],
};

const SOUTH: Menu = {
  'Tiffin': [
    ['Ghee roast dosa', 'Crisp dosa, sambar, three chutneys', 245, 'veg', 1, ['bestseller']],
    ['Appam with stew', 'Lacy hoppers, coconut vegetable stew', 325, 'vegan', 0],
  ],
  'From the coast': [
    ['Kerala fish curry', 'Kokum, coconut milk, red rice', 595, 'non_veg', 2, ['signature']],
    ['Prawn ghee roast', 'Mangalorean spice, curry leaves', 695, 'non_veg', 3, ['chef_special']],
    ['Malabar parotta', 'Layered flaky bread', 85, 'vegan'],
  ],
  'Sweet': [['Elaneer payasam', 'Tender coconut, jaggery', 225, 'veg', 0, ['new']]],
};

const IMAGES: Record<string, string> = {
  'Paneer tikka': dish('photo-1567188040759-fb8a883dc6d8'),
  'Butter chicken': dish('photo-1603894584373-5ac82b2ae398'),
  'Dum biryani': dish('photo-1563379091339-03246963d51a'),
  'Crystal vegetable dumplings': dish('photo-1496116218417-1a781b1c416c'),
  'Salmon nigiri (2 pc)': dish('photo-1579871494447-9811cf80d66c'),
  'Wood-fired margherita': dish('photo-1574071318508-1cdbab80d002'),
  'Truffle fries': dish('photo-1573080496219-bb080dd4f877'),
  'Ghee roast dosa': dish('photo-1589301760014-d929f3979dbc'),
};

function menuFor(cuisines: string[]): Menu {
  const lead = cuisines.join(' ').toLowerCase();
  if (/asian|sushi|chinese|thai/.test(lead)) return ASIAN;
  if (/south indian|kerala|seafood/.test(lead)) return SOUTH;
  if (/continental|italian|mediterranean|cafe|bbq|american|brewpub|healthy/.test(lead) && !/north indian|rajasthani/.test(lead)) {
    return CONTINENTAL;
  }
  return INDIAN;
}

export async function seedMenus(restaurants: { id: string; cuisines: string[] }[]): Promise<void> {
  for (const [index, restaurant] of restaurants.entries()) {
    const scale = 0.9 + (index % 4) * 0.08;
    const menu = menuFor(restaurant.cuisines);
    for (const [sectionSort, [sectionName, dishes]] of Object.entries(menu).entries()) {
      const section = await queryOne<{ id: string }>(
        'INSERT INTO dining.menu_sections (restaurant_id, name, sort) VALUES ($1, $2, $3) RETURNING id',
        [restaurant.id, sectionName, sectionSort],
      );
      for (const [sort, [name, description, price, diet, spice = 0, badges = []]] of dishes.entries()) {
        await query(
          `INSERT INTO dining.menu_items
             (restaurant_id, section_id, name, description, price_paise, diet, spice_level, badges, image_url, is_available, sort)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            restaurant.id,
            section!.id,
            name,
            description,
            Math.round((price * scale) / 5) * 5 * 100,
            diet,
            spice,
            badges,
            IMAGES[name] ?? null,
            // One dish per menu sold out tonight, so the state is visible in the demo.
            !(sectionSort === 1 && sort === 3),
            sort,
          ],
        );
      }
    }
  }
}
