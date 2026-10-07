/**
 * Invented vocabulary for the demo database.
 *
 * Every firm name in the demo is built from these parts. The stems are coined
 * syllable combinations rather than real place-words or surnames, so a
 * combination does not land on a real fund or a real miner — a real firm
 * shown beside an invented AUM figure would be a problem.
 */

export const STEMS = [
  "Vorandel","Vororvik","Vormaren","Voristel","Voravorn","Vorelund","Vorithra","Vorodane","Voruvara",
  "Vorenmor","Quelandel","Quelorvik","Quelmaren","Quelistel","Quelavorn","Quelelund","Quelithra","Quelodane",
  "Queluvara","Quelenmor","Zanandel","Zanorvik","Zanmaren","Zanistel","Zanavorn","Zanelund","Zanithra",
  "Zanodane","Zanuvara","Zanenmor","Thalandel","Thalorvik","Thalmaren","Thalistel","Thalavorn","Thalelund",
  "Thalithra","Thalodane","Thaluvara","Thalenmor","Brevandel","Brevorvik","Brevmaren","Brevistel","Brevavorn",
  "Brevelund","Brevithra","Brevodane","Brevuvara","Brevenmor","Ostandel","Ostorvik","Ostmaren","Ostistel",
  "Ostavorn","Ostelund","Ostithra","Ostodane","Ostuvara","Ostenmor","Kaelandel","Kaelorvik","Kaelmaren",
  "Kaelistel","Kaelavorn","Kaelelund","Kaelithra","Kaelodane","Kaeluvara","Kaelenmor","Myrandel","Myrorvik",
  "Myrmaren","Myristel","Myravorn","Myrelund","Myrithra","Myrodane","Myruvara","Myrenmor","Selandel",
  "Selorvik","Selmaren","Selistel","Selavorn","Selelund","Selithra","Selodane","Seluvara","Selenmor",
  "Yonandel","Yonorvik","Yonmaren","Yonistel","Yonavorn","Yonelund","Yonithra","Yonodane","Yonuvara",
  "Yonenmor","Dravandel","Dravorvik","Dravmaren","Dravistel","Dravavorn","Dravelund","Dravithra","Dravodane",
  "Dravuvara","Dravenmor","Ulvandel","Ulvorvik","Ulvmaren","Ulvistel","Ulvavorn","Ulvelund","Ulvithra",
  "Ulvodane","Ulvuvara","Ulvenmor","Prynandel","Prynorvik","Prynmaren","Prynistel","Prynavorn","Prynelund",
  "Prynithra","Prynodane","Prynuvara","Prynenmor","Corvandel","Corvorvik","Corvmaren","Corvistel","Corvavorn",
  "Corvelund","Corvithra","Corvodane","Corvuvara","Corvenmor","Nyrandel","Nyrorvik","Nyrmaren","Nyristel",
  "Nyravorn","Nyrelund","Nyrithra","Nyrodane","Nyruvara","Nyrenmor","Halvandel","Halvorvik","Halvmaren",
  "Halvistel","Halvavorn","Halvelund","Halvithra","Halvodane","Halvuvara","Halvenmor","Ivandel","Ivorvik",
  "Ivmaren","Ivistel","Ivavorn","Ivelund","Ivithra","Ivodane","Ivuvara","Ivenmor","Jaskandel",
  "Jaskorvik","Jaskmaren","Jaskistel","Jaskavorn","Jaskelund","Jaskithra","Jaskodane","Jaskuvara","Jaskenmor",
  "Lomandel","Lomorvik","Lommaren","Lomistel","Lomavorn","Lomelund","Lomithra","Lomodane","Lomuvara",
  "Lomenmor","Fennandel","Fennorvik","Fennmaren","Fennistel","Fennavorn","Fennelund","Fennithra","Fennodane",
  "Fennuvara","Fennenmor","Grevandel","Grevorvik","Grevmaren","Grevistel","Grevavorn","Grevelund","Grevithra",
  "Grevodane","Grevuvara","Grevenmor","Eskandel","Eskorvik","Eskmaren","Eskistel","Eskavorn","Eskelund",
  "Eskithra","Eskodane","Eskuvara","Eskenmor","Tavandel","Tavorvik","Tavmaren","Tavistel","Tavavorn",
  "Tavelund","Tavithra","Tavodane","Tavuvara","Tavenmor","Wynandel","Wynorvik","Wynmaren","Wynistel",
  "Wynavorn","Wynelund","Wynithra","Wynodane","Wynuvara","Wynenmor","Raskandel","Raskorvik","Raskmaren",
  "Raskistel","Raskavorn","Raskelund","Raskithra","Raskodane","Raskuvara","Raskenmor",
];

export const SECOND = [
  "Ridge","Point","Harbour","Crest","Hollow","Bay","Reach","Field","Gate","Court",
  "Row","Vale","Mill","Bridge","Cross","Head","Barrow","Lane","Wharf","Cove",
];

export const FUND_SUFFIX = [
  "Capital","Capital Partners","Partners","Asset Management","Advisors",
  "Investment Management","Investments","Holdings","Ventures","Fund Management",
  "Capital Management","Global Partners","Equity Partners","Resource Partners",
];

export const MINER_SUFFIX = [
  "Resources","Minerals","Metals","Mining","Exploration","Resources Limited",
  "Mining Corporation","Metals Group","Energy","Mineral Resources","Mining Group",
];

export const INTER_SUFFIX = [
  "Securities","Advisory","Corporate Finance","Capital Markets","Legal",
  "& Partners","Consulting","Engineering","Communications","& Co","Partners LLP",
  "Geological Services","Research","Exchange Services",
];

export const FORENAMES = [
  "Adam","Adele","Adrian","Ainsley","Alan","Alba","Alec","Alexa","Alice","Amara",
  "Ambrose","Amelia","Anders","Andrea","Aneta","Angus","Anita","Anneke","Anthea","Arjun",
  "Arne","Astrid","Aurelio","Ava","Barnaby","Beatriz","Ben","Bianca","Bram","Brendan",
  "Bridget","Bruno","Caitlin","Callum","Camila","Carlos","Carmen","Cassia","Cathal","Cecilia",
  "Cedric","Charlotte","Chiara","Ciaran","Clara","Colm","Conrad","Cora","Cormac","Daniela",
  "Darius","Davina","Declan","Delia","Diego","Dilan","Dominic","Dora","Duncan","Eamon",
  "Edith","Eero","Elena","Eliot","Elke","Emeka","Emil","Emilia","Enzo","Erica",
  "Esben","Esme","Ewan","Fabian","Fadi","Farida","Felix","Fenella","Fergus","Finn",
  "Fiona","Flora","Franco","Freya","Gabriel","Gemma","Georgia","Gerard","Gilles","Gita",
  "Gregor","Greta","Gustav","Hana","Hanna","Harriet","Hassan","Heidi","Helena","Henrik",
  "Hugo","Ida","Ilse","Imogen","Ines","Ingrid","Ira","Isabel","Ivan","Jae",
  "Jasper","Javier","Jelena","Jemima","Joachim","Johanna","Jonas","Josef","Juliet","Junko",
  "Kaia","Kamil","Karan","Karin","Katya","Keiko","Kelvin","Kerensa","Kiran","Klara",
  "Konrad","Lara","Lars","Laurent","Leah","Leif","Lena","Leo","Liesel","Linnea",
  "Lorcan","Louisa","Luca","Lucia","Ludo","Magnus","Maia","Malin","Manon","Marcel",
  "Margit","Mariam","Marius","Marta","Mateo","Maud","Meera","Mikael","Milena","Miriam",
  "Nadia","Nathan","Neels","Nell","Nils","Nina","Noor","Nuala","Oisin","Olga",
  "Oliver","Olof","Omar","Orla","Oscar","Otto","Paloma","Pascal","Patrice","Paula",
  "Pedro","Petra","Philippa","Pia","Piet","Quentin","Rafael","Ragna","Ravi","Rebecca",
  "Reuben","Rhona","Ricardo","Rita","Roman","Rosa","Rowan","Ruben","Ruth","Sabine",
  "Saeed","Samira","Sander","Sasha","Saul","Selina","Serge","Shona","Sigrid","Silas",
  "Simone","Sofia","Soren","Stellan","Susanna","Sven","Tadhg","Tamsin","Tanvi","Tara",
  "Teodor","Thea","Theo","Tomas","Tove","Ulrik","Una","Ursula","Valeria","Vera",
  "Viktor","Vincent","Wendel","Wilhelm","Willa","Xavier","Yara","Yohan","Yusuf","Zara",
  "Zeno","Zoe",
];

export const SURNAMES = [
  "Abernethy","Ackroyd","Aitkenhead","Alderton","Almeida","Ambrose","Anselmi","Appleyard",
  "Arden","Ashfield","Atherton","Aveling","Baccus","Bagshaw","Bainbridge","Balfour",
  "Ballantyne","Banister","Barbosa","Barlowe","Barrington","Bassett","Bathurst","Beaumont",
  "Bellingham","Benedetti","Berglund","Bertrand","Bevington","Bickerton","Birkenshaw","Blackwood",
  "Blakeney","Bligh","Bonnaire","Borthwick","Bosworth","Bracewell","Bradbury","Bramley",
  "Brandt","Brennecke","Bridgeman","Brightwell","Brockman","Broughton","Bruckner","Buchanan",
  "Burnaby","Butterworth","Cadogan","Caldicott","Callaghan","Calloway","Camberley","Cardoso",
  "Carmichael","Carruthers","Castellan","Chadwick","Chalmers","Chamberlin","Chandra","Charnock",
  "Chesterton","Chevalier","Clairmont","Clanton","Clavering","Clifton","Coleridge","Colquhoun",
  "Considine","Corfield","Cornelius","Costigan","Courtenay","Cranborne","Cresswell","Crowhurst",
  "Cullinane","Dalrymple","Danforth","Darlington","Davenport","Delacroix","Delaney","Dempsey",
  "Deverill","Dillingham","Dorrien","Doyle","Drummond","Dubois","Dunhill","Durrance",
  "Eastwood","Eberhardt","Edgeworth","Ellingham","Elphinstone","Enderby","Engelbrecht","Ernshaw",
  "Fairbairn","Falconer","Fanshawe","Farquhar","Faulkner","Fenwick","Ferreira","Fitzalan",
  "Fleetwood","Fontaine","Forrester","Fothergill","Framlingham","Frobisher","Fulbright","Gainsford",
  "Galbraith","Gallagher","Garforth","Gascoigne","Gatley","Gaunt","Gerhardt","Giffard",
  "Gilchrist","Glanville","Godfrey","Goodhart","Gormley","Grantham","Greaves","Grimshaw",
  "Guilfoyle","Hadleigh","Halloran","Hambleton","Hardcastle","Harkness","Hartnell","Haslemere",
  "Havelock","Hawkridge","Haythorne","Heatherington","Helmsley","Hennessy","Herrick","Hetherton",
  "Hildreth","Hollingworth","Holmberg","Hopcroft","Horsfall","Hoskins","Huddleston","Hulbert",
  "Ingersoll","Inglewood","Irvine","Isherwood","Jankowski","Jardine","Jefferies","Jellicoe",
  "Jessamy","Joubert","Kavanagh","Keighley","Kellaway","Kemsley","Kenrick","Kerrigan",
  "Kestleman","Kilbride","Kingscote","Kinnear","Kirkbride","Knatchbull","Kohler","Lambourne",
  "Langmead","Lascelles","Latimer","Laverty","Leighfield","Lestrange","Lindqvist","Linnell",
  "Littleton","Lockhart","Loewenthal","Longstaff","Lovelace","Lowther","Lucchese","Lyndhurst",
  "Macalister","Maddocks","Maitland","Malvern","Mandeville","Manningham","Marchetti","Markham",
  "Marlborough","Mattingly","Maybury","McAllister","McKendrick","Melhuish","Mendonca","Merriweather",
  "Middleditch","Millgate","Molyneux","Montrose","Moreton","Mortlake","Mowbray","Nankivell",
  "Nesbitt","Netherwood","Newcombe","Nicolson","Northcote","Nunnery","Oakeshott","Ockenden",
  "Oglethorpe","Ormerod","Osgood","Ottaway","Pagett","Palfrey","Pankhurst","Parminter",
  "Pattinson","Peabody","Pemberdale","Pennington","Peverell","Pickersgill","Pilkington","Pinchbeck",
  "Plumridge","Pomeroy","Poulton","Prendergast","Prideaux","Purcell","Quennell","Quilliam",
  "Radcliffe","Ramsbottom","Rasmussen","Rathbone","Ravenscroft","Redmayne","Rennison","Restrick",
  "Ridgeway","Rimmington","Rivington","Roebuck","Rothery","Rowntree","Rushforth","Rutherglen",
  "Salisbury","Sanderling","Saunderson","Scarborough","Scrivener","Seabright","Selkirk","Shackleton",
  "Shawcross","Sheldrake","Sherbourne","Sillitoe","Simcoe","Sinclair","Skelmersdale","Slattery",
  "Somerville","Southgate","Sparrowhawk","Stancliffe","Stanhope","Steadman","Stirling","Stoddart",
  "Strathmore","Sturridge","Sutcliffe","Swaffield","Sykes","Talbot","Tancred","Tattersall",
  "Templeman","Thackeray","Thistlewood","Thorburn","Threlfall","Tillotson","Tolhurst","Torrington",
  "Tremayne","Trevithick","Tunnicliffe","Turnbull","Twyford","Underhill","Uppington","Vandeleur",
  "Vansittart","Verhoeven","Vermeulen","Villiers","Wadsworth","Wainwright","Wakeling","Waldegrave",
  "Walmsley","Warburton","Wardlow","Waterhouse","Weatherby","Wendover","Westerling","Wetherall",
  "Whitcombe","Whitmarsh","Wickersham","Wilberforce","Willoughby","Winchcombe","Wingfield","Winterbourne",
  "Wolverton","Woodhouse","Wrenfield","Wycliffe","Yardley","Yeatman","Youlden","Zetland",
];

/** ISO code -> the name the app shows. */
export const COUNTRIES = {
  US: "United States", GB: "United Kingdom", AU: "Australia", CA: "Canada",
  HK: "Hong Kong", SG: "Singapore", CH: "Switzerland", AE: "United Arab Emirates",
  ZA: "South Africa", BR: "Brazil", CL: "Chile", PE: "Peru", GH: "Ghana",
  NA: "Namibia", TZ: "Tanzania", KZ: "Kazakhstan", ID: "Indonesia", JP: "Japan",
  DE: "Germany", FR: "France", SE: "Sweden", LU: "Luxembourg", NO: "Norway",
  IN: "India", CN: "China", MN: "Mongolia", ZM: "Zambia", CD: "DR Congo",
  BF: "Burkina Faso", ML: "Mali", AR: "Argentina", MX: "Mexico", PT: "Portugal",
  IE: "Ireland", NL: "Netherlands", SA: "Saudi Arabia", MZ: "Mozambique",
  BW: "Botswana", FI: "Finland", ES: "Spain",
};

export const COMMODITIES = [
  "Gold","Copper","Lithium","Silver","Nickel","Iron Ore","Coal","Uranium","Rare Earths",
  "Zinc","Cobalt","Graphite","Manganese","Potash","Tin","Tungsten","Vanadium","PGM",
  "Antimony","Molybdenum","Diamonds","Titanium",
];

export const SECTORS = [
  "Mining","Energy - Oil & Gas","Energy - Renewables","Battery & Critical Minerals",
  "Power/Utilities","Natural Resources Generalist","Generalist",
];

export const INVESTOR_TYPES = [
  "Asset Manager","Private Equity","Hedge Fund","Venture Capital","Family Office",
  "HNWI","Private Credit/Specialty Lender","Bank/CIB","Pension","Sovereign Wealth Fund",
  "Corporate/Strategic Investor","Other Investor",
];

export const AUM_BANDS = ["Under $100m","$100m - $1bn","$1bn - $10bn","$10bn - $100bn","$100bn+"];

export const INTERMEDIARY_TYPES = [
  "Bank/CIB","Broker-Dealer/Placement Agent","Corporate Advisory/Merchant Bank",
  "Commodity Trader","Royalty & Streaming","Law Firm","IR/PR/Communications",
  "Technical Consultant/QP","Research/Market Data","Exchange/Registry/Transfer Agent",
  "Conference/Events","Other",
];

export const GOV_KINDS = [
  "Ministry/Regulator","Defense/Military","Export-Credit Agency",
  "Development Finance Institution","Program/Initiative","Trade Association (gov-backed)",
  "Strategic Corporate",
];

export const MANDATES = [
  "Critical minerals","Rare earths","Battery supply chain","Uranium/nuclear",
  "Energy security","Defense industrial base","General mining","General energy",
];

export const INVESTOR_TITLES = [
  "Managing Partner","Partner","Chief Investment Officer","Portfolio Manager",
  "Head of Natural Resources","Investment Director","Principal","Managing Director",
  "Head of Mining","Investment Manager","Senior Analyst","Director of Research",
  "Head of Private Markets","Founding Partner","Head of Metals & Mining",
];

export const BUSINESS_TITLES = [
  "Chief Executive Officer","Chief Financial Officer","Managing Director",
  "Head of Corporate Development","Executive Chairman","VP Investor Relations",
  "Chief Operating Officer","Head of Exploration","Company Secretary","Non-Executive Director",
];

export const INTER_TITLES = [
  "Managing Director","Partner","Head of Mining & Metals","Director, Corporate Finance",
  "Associate Director","Senior Geologist","Head of Equity Capital Markets","Counsel",
  "Head of Research","Vice President","Principal Consultant",
];

export const GOV_TITLES = [
  "Director General","Deputy Minister","Head of Critical Minerals","Trade Commissioner",
  "Senior Adviser","Programme Director","Head of Mining Policy","Country Director",
];

export const STAGES = ["Exploration","Development","Feasibility","Producing","Care & Maintenance"];

export const INDUSTRIES = [
  "Mining","Energy - Oil & Gas","Energy - Renewables","Energy - Power/Other",
  "Metals & Steel","Battery & Energy Storage","Automotive/EV",
];
