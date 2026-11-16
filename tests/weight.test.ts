import { describe, expect, it } from "vitest";
import { classify, lookupWeight, parseWeight } from "../src/lib/weight";

describe("parseWeight", () => {
  it("reads weight from the name", () => {
    expect(parseWeight("Shaorma mare 450g", "")).toMatchObject({ grams: 450, source: "name" });
    expect(parseWeight("Pizza Diavola (0,5 kg)", "")).toMatchObject({ grams: 500 });
    expect(parseWeight("Cartofi 150 gr", "")).toMatchObject({ grams: 150 });
  });

  it("falls back to the description", () => {
    expect(parseWeight("Burger", "Carne de vită, cheddar. 320 g")).toMatchObject({
      grams: 320,
      source: "description",
    });
  });

  it("handles multipliers and chains", () => {
    expect(parseWeight("Mici 5 x 60g", "")).toMatchObject({ grams: 300 });
    expect(parseWeight("Platou", "200g + 150g + 50g")).toMatchObject({ grams: 400, uncertain: false });
  });

  it("adds up the solid parts of a combo, without the drink and the sauce", () => {
    expect(
      parseWeight("Meniu Twister", "Twister® Picant 180g, 1 porție mare de cartofi prăjiți 120g, 1 băutură răcoritoare 0,5L."),
    ).toMatchObject({ grams: 300, uncertain: false, volume: false });
    expect(
      parseWeight("Meniu 8 Strips", "8 Strips 240g, 1 porție mare de cartofi prăjiți 120g, 1 băutură 0,5L, 1 sos la alegere 54g/25g."),
    ).toMatchObject({ grams: 360 });
    expect(parseWeight("Bucket", "10 Crispy Strips® 300g, 10 Hot Wings® 250g, 2 porții de cartofi 2x90g.")).toMatchObject({
      grams: 730,
    });
  });

  it("counts the smallest of several alternatives", () => {
    expect(
      parseWeight("Top Box", "1 Dublu Booster (165g) sau 1 Dublu Crispy Burger (150g), 2 Strips (60g), cartofi (120g), racoritoare (0.5L)."),
    ).toMatchObject({ grams: 330, uncertain: false });
    expect(parseWeight("Meniu copii", "Booster Junior 100g, cartofi 90g sau 1 mini porumb 90g, 1 băutură 0,4L")).toMatchObject({
      grams: 190,
    });
  });

  it("ignores nutritional references", () => {
    expect(parseWeight("Burger", "250 kcal/100g")).toBeNull();
    expect(parseWeight("Kebab", "Carne pui, cartofi. VALOARE ENERGETICA KJ/Kcal 100g: 355 / 85")).toBeNull();
    expect(parseWeight("Bagheta", "Carne, lipie. Valori Nutritionale: Grasimi: VITA: 5.3 g, Glucide: 12.32 g Pui: Grasimi: 3.69 g")).toBeNull();
    expect(parseWeight("Burger", "Valori la 100 g: 12g proteine")).toBeNull();
    expect(parseWeight("Burger", "300g. Energie 250 kcal / 100g")).toMatchObject({ grams: 300, uncertain: false });
  });

  it("flags several unrelated weights as uncertain", () => {
    const r = parseWeight("Platou", "Aripioare 300g cu cartofi 200g");
    expect(r).toMatchObject({ grams: 500, uncertain: true });
  });

  it("converts volumes", () => {
    expect(parseWeight("Coca-Cola 0.5L", "")).toMatchObject({ grams: 500, volume: true });
    expect(parseWeight("Apă 330 ml", "")).toMatchObject({ grams: 330 });
  });

  it("returns null without a weight", () => {
    expect(parseWeight("Big Mac", "Doi burgeri de vită")).toBeNull();
  });
});

describe("classify", () => {
  it("uses the category", () => {
    expect(classify("Coca-Cola", "Băuturi")).toBe("drink");
    expect(classify("Usturoi", "Sosuri")).toBe("sauce");
    expect(classify("Big Mac", "Burgeri")).toBe("food");
    expect(classify("Really Crunchy Fries", "Fries & Sauces")).toBe("side");
    expect(classify("Barbeque 25G", "Dips & Sauces")).toBe("sauce");
  });
  it("uses the name carefully", () => {
    expect(classify("Sos de usturoi", "Extra")).toBe("sauce");
    expect(classify("Burger cu sos BBQ", "Burgeri")).toBe("food");
    expect(classify("Pepsi 500ml", "Extra", true)).toBe("drink");
    expect(classify("Supă de pui 400ml", "Supe", true)).toBe("other");
    expect(classify("Cheese sosuri 50g", "Extra", false, 50)).toBe("sauce");
    expect(classify("Burger cu sos BBQ 250g", "Burgeri", false, 250)).toBe("food");
    // A big tub of sauce is not a meal.
    expect(classify("Ranch Dip N'Drip 200g", "Dip N’Drip", false, 200)).toBe("sauce");
    expect(classify("Voodoo Dip N'Drip 200 g", "Dip N’Drip", false, 200)).toBe("sauce");
    expect(classify("The Garlic Sauce (200g)", "Popeyes Classics", false, 200)).toBe("sauce");
    expect(classify("Tenders&Dip N’Drip Combo", "News", false, 200)).toBe("food");
    expect(classify("5 buc. Swing Onion Wings", "Sauce'd", false, 174)).toBe("food");
    expect(classify("Coleslaw Chicken Sandwich", "Sandvișuri & Wrap-uri", false, 259)).toBe("food");
    expect(classify("Coleslaw", "Sides", false, 125)).toBe("salad");
  });

  it("does not add up the variants of one product", () => {
    expect(
      parseWeight(
        "Loaded XL Burrito",
        "Loaded XL Burrito 400gLoaded XL Burrito cu carne de vita condimentata 400g (27E) 949 kJ /227 kcalAlergeni: gluten, ou, lapte.Loaded XL Burrito cu carne de pui 400g (24E) 888 kJ",
      ),
    ).toMatchObject({ grams: 400, uncertain: false });
    expect(parseWeight("Platou", "Burger 150g, cartofi 150g")).toMatchObject({ grams: 300 });
    expect(classify("Chips cu sare", "Fursecuri si chips-uri", false, 40)).toBe("other");
  });

  it("reads weights glued to the next word and a stated total", () => {
    expect(
      parseWeight("Smart Deal Menu", "Panini, carne kebab, sos alb, ceapă roșie - 230gCartofi prăjiti - 130 grCoca-Cola - 330ml. Băutura conține garanție SGR."),
    ).toMatchObject({ grams: 360, volume: false });
    expect(parseWeight("Meniu Crispy Gyros", "Crispy Gyros 415g, cartofi prajiti 100g, bautura la alegere - 515g + 330ml")).toMatchObject({ grams: 515, uncertain: false });
    expect(
      parseWeight("Meniu Gyros XXL", "Gyros Puisor 490gr, Cartofi prajiti 100gr, Sos la alegere 40gr, bautura racoritoare - 630gr + 330ml"),
    ).toMatchObject({ grams: 630 });
    expect(parseWeight("Smart Combo Pui cu doză 330ml", "Panini, carne kebab, ceapă roșie - 230g,o doză 330ml.")).toMatchObject({ grams: 230, volume: false });
    expect(parseWeight("2 LEGUME LA ALEGERE", "")).toBeNull();
    expect(parseWeight("DONER BOX PUI", "CARNE 200 GR, CARTOFI 200 GR, GREUTATE MINIMA PRODUS 450 GR")).toMatchObject({ grams: 450 });
    expect(
      parseWeight("Lipie mare de pui", "Kebab mare de pui (600g ) (15E | 1.13g sare | 3.2g zaharuri)/100g Sis de pui, Lipie alba, Valoare energetică: 568.86Kj/135.97KCal, Grăsimi: 4.14g (Din care acizi grași saturați: 1g), Glucide: 17.18g (Din care zaharuri: 3.2g), Proteine: 6.67g"),
    ).toMatchObject({ grams: 600 });
    expect(
      parseWeight("Pită Șnițel", "Șnițel puișor 80g, cartofi prăjiți 60g, salată varză 60g, sos usturoi 40g, sos dulce - acrișor 20g, castraveti murați - 395g"),
    ).toMatchObject({ grams: 395, uncertain: false });
    expect(parseWeight("Meniu Veggie Bowl", "Veggie Bowl 375g, apa la alegere - 375g + 500ml")).toMatchObject({ grams: 375 });
    expect(classify("Panini", "Kebab Pui", false, 100)).toBe("other");
    expect(classify("Plant-Based Whopper", "Burgeri", false, 274)).toBe("other");
    expect(classify("Meniu Plant-based Royale", "Meniuri", false, 185)).toBe("other");
    expect(classify("Veggie Bowl", "VEGAN/VEGETARIAN", false, 375)).toBe("other");
    expect(classify("Whopper", "Burgeri", false, 270)).toBe("food");
    expect(classify("Panini cu pui", "Sandvișuri", false, 250)).toBe("food");
    expect(classify("Smart Combo Pui cu doză 330ml", "Kebab Pui", false, 230)).toBe("food");
  });

  it("does not add up an ingredient list", () => {
    const ingr = "INGREDIENTE: Carne de pui în pesmet ⊛: (carne fiartă de pui (64%))-(75g), Chifla ⊛: (făină de GRÂU)-(54g), Salata (20g)";
    expect(parseWeight("Chicken Wrap", `Pui crocant, salată, maioneză. Porție (181g). ${ingr}`)).toMatchObject({ grams: 181, uncertain: false });
    expect(parseWeight("King Nuggets", "9 Nuggets de pui, alături de un sos la alegere. Porție (9buc/127g).")).toMatchObject({ grams: 127 });
    expect(parseWeight("Whopper", `Carne de vită 100% facută la grătar, într-o chiflă cu SUSAN.${ingr}`)).toMatchObject({ uncertain: true });
    expect(parseWeight("Cheester", "150 g de carne de vită la grătar, o felie de branză Gouda pane, într-o chifla delicioasa.(280g)Burger INGR:Carne de vită (90g),Chifla (70g)")).toMatchObject({ grams: 280, uncertain: false });
    expect(parseWeight("Burger", "Ingrediente: chiflă, vită, cheddar. 320g")).toMatchObject({ grams: 320, uncertain: false });
  });

  it("does not take one part's weight for a whole combo", () => {
    expect(
      parseWeight("Tenders&Dip N’Drip Combo", "5 crispy chicken tenders paired with our Dip ’n Drip (200 g) and a Pepsi"),
    ).toMatchObject({ grams: 200, uncertain: true });
    expect(parseWeight("Chicken Sandwich", "(214 g) Faimosul Chicken Sandwich")).toMatchObject({ grams: 214, uncertain: false });
  });
});

describe("classify: mains and sides", () => {
  it("keeps fries and fried snacks as sides", () => {
    expect(classify("Cartofi prăjiţi porţie mare, 150 gr", "Cartofi prăjiţi şi sosuri")).toBe("side");
    expect(classify("Cartofi prăjiți porție mică", "Garnituri")).toBe("side");
    expect(classify("Chili Cheese Nuggets", "Garnituri")).toBe("side");
  });
  it("sets salads, fruit, bread and desserts apart", () => {
    expect(classify("Mini-porumb", "Garnituri")).toBe("other");
    expect(classify("Chiflă imperiala", "Garnituri")).toBe("other");
    expect(classify("Greek Salad", "Salate")).toBe("salad");
    expect(classify("Meniu pentru copii cu Booster Junior", "Meniuri pui")).toBe("other");
    expect(classify("Salată cu Fillet Bites®", "Salate")).toBe("salad");
    expect(classify("Tartă cu ciocolată", "Deserturi")).toBe("dessert");
    expect(classify("FELII DE MAR 80G", "Happy Meal®")).toBe("other");
    expect(classify("McFlurry® Oreo", "Noutăți")).toBe("dessert");
    expect(classify("Înghețată la cornet", "Diverse")).toBe("dessert");
    expect(classify("Caesar", "Salate")).toBe("salad");
    expect(classify("Bacon", "Extra toppinguri")).toBe("other");
    expect(classify("Salată Coleslaw, mix de legume, 200 gr", "Noutăți")).toBe("salad");
  });
  it("keeps real meals as mains", () => {
    expect(classify("Zinger® Burger", "Burgers & Wraps")).toBe("food");
    expect(classify("8 Hot Wings®", "Pui")).toBe("food");
    expect(classify("Loaded Chicken Fries BBQ Picant", "Noutati")).toBe("side");
    expect(classify("Loaded Nachos", "Noutati")).toBe("side");
    expect(classify("Doritos Loaded Spicy", "Noutati")).toBe("side");
    expect(classify("Loaded Burger", "Noutati")).toBe("food");
    expect(classify("Meniu Twister® Picant", "Garnituri")).toBe("food");
    expect(classify("Hot Bucket", "Buckets")).toBe("food");
  });
  it("treats any bottle or glass as a drink, whatever the category", () => {
    expect(classify("Izvorul Alb 0,5L", "Diverse", true, 500)).toBe("drink");
    expect(classify("Ciorbă de văcuță 400ml", "Diverse", true, 400)).toBe("other");
  });
});

describe("lookupWeight", () => {
  const tables = [{ match: ["mcdonald"], items: { "Big Mac": 219 } }];
  it("matches by chain and normalized item name", () => {
    expect(lookupWeight(tables, "McDonald's Unirii", "Big Mac™")).toBe(219);
    expect(lookupWeight(tables, "McDonald's Unirii", "big mac")).toBe(219);
    expect(lookupWeight(tables, "KFC", "Big Mac")).toBeNull();
  });
});
