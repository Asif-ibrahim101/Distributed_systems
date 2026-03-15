db = db.getSiblingDB('jokedb');

db.types.insertMany([
    { type: 'general' },
    { type: 'programming' },
    { type: 'dad' },
    { type: 'knock-knock' }
]);

db.jokes.insertMany([
    { setup: 'What do you call a fake noodle?', punchline: 'An impasta.', type: 'general' },
    { setup: 'Why did the scarecrow win an award?', punchline: 'Because he was outstanding in his field.', type: 'general' },
    { setup: 'What do you call a bear with no teeth?', punchline: 'A gummy bear.', type: 'general' },
    { setup: 'Why don\'t scientists trust atoms?', punchline: 'Because they make up everything.', type: 'general' },
    { setup: 'What did the ocean say to the beach?', punchline: 'Nothing, it just waved.', type: 'general' },

    { setup: 'Why do programmers prefer dark mode?', punchline: 'Because light attracts bugs.', type: 'programming' },
    { setup: 'What\'s a programmer\'s favourite hangout place?', punchline: 'Foo Bar.', type: 'programming' },
    { setup: 'Why do Java developers wear glasses?', punchline: 'Because they can\'t C#.', type: 'programming' },
    { setup: 'How many programmers does it take to change a light bulb?', punchline: 'None, that\'s a hardware problem.', type: 'programming' },
    { setup: 'Why was the JavaScript developer sad?', punchline: 'Because he didn\'t Node how to Express himself.', type: 'programming' },

    { setup: 'I\'m reading a book about anti-gravity.', punchline: 'It\'s impossible to put down!', type: 'dad' },
    { setup: 'Did you hear about the restaurant on the moon?', punchline: 'Great food, no atmosphere.', type: 'dad' },
    { setup: 'Why couldn\'t the bicycle stand up by itself?', punchline: 'It was two tired.', type: 'dad' },
    { setup: 'What do you call a dog that does magic tricks?', punchline: 'A Labracadabrador.', type: 'dad' },
    { setup: 'I used to hate facial hair, but then it grew on me.', punchline: 'Now I\'m a big fan.', type: 'dad' },

    { setup: 'Knock knock. Who\'s there? Boo.', punchline: 'Boo who? Don\'t cry, it\'s just a joke!', type: 'knock-knock' },
    { setup: 'Knock knock. Who\'s there? Lettuce.', punchline: 'Lettuce who? Lettuce in, it\'s cold out here!', type: 'knock-knock' },
    { setup: 'Knock knock. Who\'s there? Nobel.', punchline: 'Nobel who? Nobel, that\'s why I knocked!', type: 'knock-knock' },
    { setup: 'Knock knock. Who\'s there? Atch.', punchline: 'Atch who? Bless you!', type: 'knock-knock' },
    { setup: 'Knock knock. Who\'s there? Tank.', punchline: 'Tank who? You\'re welcome!', type: 'knock-knock' }
]);
