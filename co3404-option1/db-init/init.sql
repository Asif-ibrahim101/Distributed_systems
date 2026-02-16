-- Schema: create types and jokes tables with a foreign key relationship
CREATE TABLE IF NOT EXISTS types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS jokes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setup TEXT NOT NULL,
  punchline TEXT NOT NULL,
  type_id INT NOT NULL,
  FOREIGN KEY (type_id) REFERENCES types(id)
);

-- Seed joke types
INSERT INTO types (type) VALUES
  ('general'),
  ('programming'),
  ('dad'),
  ('knock-knock');

-- Seed jokes: at least 4-5 per type so random selection is meaningful

-- General jokes (type_id = 1)
INSERT INTO jokes (setup, punchline, type_id) VALUES
  ('What do you call a fake noodle?', 'An impasta.', 1),
  ('Why did the scarecrow win an award?', 'Because he was outstanding in his field.', 1),
  ('What do you call a bear with no teeth?', 'A gummy bear.', 1),
  ('Why don''t scientists trust atoms?', 'Because they make up everything.', 1),
  ('What did the ocean say to the beach?', 'Nothing, it just waved.', 1);

-- Programming jokes (type_id = 2)
INSERT INTO jokes (setup, punchline, type_id) VALUES
  ('Why do programmers prefer dark mode?', 'Because light attracts bugs.', 2),
  ('What''s a programmer''s favourite hangout place?', 'Foo Bar.', 2),
  ('Why do Java developers wear glasses?', 'Because they can''t C#.', 2),
  ('How many programmers does it take to change a light bulb?', 'None, that''s a hardware problem.', 2),
  ('Why was the JavaScript developer sad?', 'Because he didn''t Node how to Express himself.', 2);

-- Dad jokes (type_id = 3)
INSERT INTO jokes (setup, punchline, type_id) VALUES
  ('I''m reading a book about anti-gravity.', 'It''s impossible to put down!', 3),
  ('Did you hear about the restaurant on the moon?', 'Great food, no atmosphere.', 3),
  ('Why couldn''t the bicycle stand up by itself?', 'It was two tired.', 3),
  ('What do you call a dog that does magic tricks?', 'A Labracadabrador.', 3),
  ('I used to hate facial hair, but then it grew on me.', 'Now I''m a big fan.', 3);

-- Knock-knock jokes (type_id = 4)
INSERT INTO jokes (setup, punchline, type_id) VALUES
  ('Knock knock. Who''s there? Boo.', 'Boo who? Don''t cry, it''s just a joke!', 4),
  ('Knock knock. Who''s there? Lettuce.', 'Lettuce who? Lettuce in, it''s cold out here!', 4),
  ('Knock knock. Who''s there? Nobel.', 'Nobel who? Nobel, that''s why I knocked!', 4),
  ('Knock knock. Who''s there? Atch.', 'Atch who? Bless you!', 4),
  ('Knock knock. Who''s there? Tank.', 'Tank who? You''re welcome!', 4);
