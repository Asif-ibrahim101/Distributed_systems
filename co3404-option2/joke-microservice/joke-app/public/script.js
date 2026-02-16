const typeSelect = document.getElementById('type-select');
const getJokeBtn = document.getElementById('get-joke-btn');
const jokeDisplay = document.getElementById('joke-display');
const jokeSetup = document.getElementById('joke-setup');
const jokePunchline = document.getElementById('joke-punchline');

/**
 * Fetch all joke types from the server and populate the dropdown.
 * Called every time the dropdown is clicked/focused so it stays current
 * (e.g. if new types were added via the submit app).
 */
async function loadTypes() {
    try {
        const res = await fetch('/types');
        const types = await res.json();

        // Preserve whatever the user currently has selected
        const currentValue = typeSelect.value;

        // Rebuild dropdown options: always include "any" as the first option
        typeSelect.innerHTML = '<option value="any">Any</option>';
        types.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            typeSelect.appendChild(option);
        });

        // Restore previous selection if it still exists
        if ([...typeSelect.options].some(opt => opt.value === currentValue)) {
            typeSelect.value = currentValue;
        }
    } catch (err) {
        console.error('Failed to load types:', err);
    }
}

/**
 * Fetch a random joke of the selected type and display it.
 * Shows the setup immediately, then reveals the punchline after 3 seconds.
 */
async function getJoke() {
    const type = typeSelect.value;

    try {
        const res = await fetch(`/joke/${type}`);
        const jokes = await res.json();

        if (jokes.error) {
            jokeSetup.textContent = jokes.error;
            jokePunchline.classList.add('hidden');
            jokeDisplay.classList.remove('hidden');
            return;
        }

        if (jokes.length === 0) {
            jokeSetup.textContent = 'No jokes found for this type!';
            jokePunchline.classList.add('hidden');
            jokeDisplay.classList.remove('hidden');
            return;
        }

        const joke = jokes[0];

        // Show the setup immediately
        jokeSetup.textContent = joke.setup;
        jokePunchline.classList.add('hidden');
        jokeDisplay.classList.remove('hidden');

        // Reveal the punchline after a 3-second delay for comedic effect
        setTimeout(() => {
            jokePunchline.textContent = joke.punchline;
            jokePunchline.classList.remove('hidden');
        }, 3000);
    } catch (err) {
        console.error('Failed to fetch joke:', err);
        jokeSetup.textContent = 'Error fetching joke. Please try again.';
        jokePunchline.classList.add('hidden');
        jokeDisplay.classList.remove('hidden');
    }
}

// Refresh types every time the dropdown is interacted with
typeSelect.addEventListener('focus', loadTypes);
typeSelect.addEventListener('click', loadTypes);

// Fetch joke on button click
getJokeBtn.addEventListener('click', getJoke);

// Load types on initial page load
loadTypes();
