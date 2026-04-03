// ==========================================
// DEMO TEMPLATE TYPESCRIPT (Βασικές Έννοιες)
// ==========================================

// 1. Βασικοί Τύποι Δεδομένων (Basic Types)
// Δηλώνουμε ρητά τον τύπο της κάθε μεταβλητής
let greeting: string = "Hello, TypeScript!";
let age: number = 25;
let isActive: boolean = true;

// Ο τύπος 'any' σημαίνει ότι μπορεί να πάρει οποιαδήποτε τιμή (αποφύγετε να τον χρησιμοποιείτε συχνά)
let anything: any = "Κείμενο";
anything = 42; 

// Πίνακες (Arrays)
let numbersList: number[] = [1, 2, 3, 4, 5]; 
let namesList: Array<string> = ["Μαρία", "Γιώργος"];

// 2. Διεπαφές (Interfaces)
// Τις χρησιμοποιούμε για να περιγράψουμε τη δομή ενός αντικειμένου (π.χ. τι ιδιότητες πρέπει να έχει)
interface User {
    name: string;
    age: number;
    email?: string; // Το σύμβολο '?' σημαίνει ότι αυτή η ιδιότητα είναι προαιρετική
}

// Δημιουργούμε ένα αντικείμενο με βάση το παραπάνω Interface
const myUser: User = {
    name: "Γιάννης",
    age: 30
    // Το email λείπει, αλλά δεν υπάρχει σφάλμα διότι είναι προαιρετικό
};

// 3. Συναρτήσεις (Functions)
// Ορίζουμε τους τύπους των παραμέτρων (a, b) καθώς και τον τύπο που επιστρέφει η συνάρτηση (στο τέλος : number)
function addNumbers(a: number, b: number): number {
    return a + b;
}

// Arrow function με τύπους (σύγχρονος τρόπος γραφής)
const multiplyNumbers = (x: number, y: number): number => {
    return x * y;
};

// Αν μια συνάρτηση δεν επιστρέφει τίποτα, βάζουμε τύπο 'void'
function logMessage(msg: string): void {
    console.log(msg);
}

// 4. Κλάσεις (Classes)
// Η TypeScript βελτιώνει τις κλάσεις της JavaScript προσθέτοντας modifiers όπως public, private, protected
class Animal {
    public name: string;          // Προσβάσιμο από παντού
    private species: string;      // Προσβάσιμο ΜΟΝΟ μέσα στην κλάση Animal

    constructor(name: string, species: string) {
        this.name = name;
        this.species = species;
    }

    public makeSound(): void {
        console.log(`${this.name} (${this.species}) κάνει έναν ήχο.`);
    }
}

const myDog = new Animal("Rex", "Σκύλος");
myDog.makeSound();

// 5. Types (Type Aliases)
// Μοιάζουν με τα Interfaces, αλλά μπορούν να χρησιμοποιηθούν και για απλούς τύπους ή συνδυασμούς αυτών (unions)
type ID = string | number; // Η μεταβλητή τύπου ID μπορεί να είναι είτε string είτε number

type Point = {
    x: number;
    y: number;
};

const coordinate: Point = { x: 10, y: 20 };
let currentUserId: ID = 12345;
currentUserId = "USER-123";

// 6. Generics (Γενικοί Τύποι)
// Μας επιτρέπουν να γράψουμε κώδικα ο οποίος λειτουργεί με πολλούς διαφορετικούς τύπους
function getArray<T>(items: T[]): T[] {
    return new Array().concat(items);
}

// Εδώ η συνάρτηση καταλαβαίνει ότι το T είναι number
let numArray = getArray<number>([1, 2, 3]);

// Εδώ καταλαβαίνει ότι το T είναι string
let strArray = getArray<string>(["Ένα", "Δύο"]);